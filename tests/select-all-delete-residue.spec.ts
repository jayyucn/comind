/**
 * 复现/回归：块全选删除后残留选择状态（2026-10-22 用户截图）。
 *
 * 根因：保留块正处编辑态时 activateBlock 是 no-op，挂载中的 PM 编辑器选区
 *（Ctrl+A 的 Text/AllSelection）映射穿过整篇替换后仍是全选 ⇒ 原生 ::selection
 * 罩住清空后的空行（暗色 = 行首紫带）。修复：deleteSelectedBlocks 对已激活的
 * 保留块先同步 PM 文档为 store 终值并折叠选区，再失活→重激活强制重挂载。
 *
 * 运行: `npm run dev`(已起则复用)后 `npx playwright test tests/select-all-delete-residue.spec.ts`
 */
import { test, expect, type Page } from '@playwright/test'

/** 等待最后一个块进入编辑态（activeElement 落在 .tiptap 内） */
async function waitLastActive(page: Page) {
  await page.waitForFunction(() => {
    const blocks = document.querySelectorAll('.block')
    const last = blocks[blocks.length - 1]
    return !!last && last.contains(document.activeElement)
  }, undefined, { timeout: 8000 })
}

/** 激活块当前文本 */
async function activeBlockText(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const active = document.querySelector('.block.active .tiptap')
    return active ? active.textContent : null
  })
}

/** 打字 + 校验 + 补打被吞字符（编辑器挂载竞态） */
async function typeRobust(page: Page, text: string) {
  await page.keyboard.type(text, { delay: 40 })
  for (let i = 0; i < 3; i++) {
    const cur = await activeBlockText(page)
    if (cur === text) return
    const missing = text.slice((cur ?? '').length)
    if (missing) await page.keyboard.type(missing, { delay: 40 })
    await page.waitForTimeout(200)
  }
  const cur = await activeBlockText(page)
  if (cur !== text) throw new Error(`打字失败: expect=${text} got=${cur}`)
}

async function setupBlocks(page: Page, texts: string[]) {
  const first = page.locator('.block').first()
  await first.click()
  await waitLastActive(page)
  await typeRobust(page, texts[0])
  for (let i = 1; i < texts.length; i++) {
    await page.keyboard.press('Enter')
    await waitLastActive(page)
    await typeRobust(page, texts[i])
  }
  const count = await page.evaluate(() => document.querySelectorAll('.block').length)
  if (count !== texts.length) throw new Error(`块数不符: ${count} != ${texts.length}`)
}

async function readResidue(page: Page) {
  return page.evaluate(() => ({
    textRects: Array.from(document.querySelectorAll('.text-selection-rect')).map((el) => {
      const b = el.getBoundingClientRect()
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
    }),
    cbSelected: document.querySelectorAll('.block.cb-selected').length,
    active: document.querySelectorAll('.block.active').length,
    blocks: Array.from(document.querySelectorAll('.block')).map((b) => ({
      text: b.querySelector('.tiptap')?.textContent ?? '(render)',
      sel: b.classList.contains('cb-selected'),
    })),
    nativeSel: (() => {
      const s = window.getSelection()
      if (!s || s.rangeCount === 0) return null
      const r = s.getRangeAt(0)
      const rects = Array.from(r.getClientRects()).map((b) => ({ w: Math.round(b.width), h: Math.round(b.height) }))
      return { collapsed: s.isCollapsed, rects }
    })(),
  }))
}

/** 公共断言（选区层）：无覆盖层残留 + 原生选区已折叠（无 ::selection 残带） */
async function expectNoSelectionResidue(page: Page, tag: string) {
  const r = await readResidue(page)
  console.log(tag, JSON.stringify(r))
  expect(r.textRects.length, 'text-selection-rect 残留').toBe(0)
  expect(r.cbSelected, 'cb-selected 残留').toBe(0)
  if (r.nativeSel) {
    expect(r.nativeSel.collapsed, '原生选区未折叠（::selection 残留）').toBe(true)
    expect(r.nativeSel.rects.length, '原生选区矩形残留').toBe(0)
  }
  return r
}

/** 公共断言（全量）：选区层 + 只剩保留块且已清空 */
async function expectNoResidue(page: Page, tag: string) {
  const r = await expectNoSelectionResidue(page, tag)
  expect(r.blocks.length, '应只剩保留块').toBe(1)
  expect(r.blocks[0].text, '保留块内容应已清空').toBe('')
  return r
}

test('块全选(Ctrl+Shift+A)删除后不残留选区高亮', async ({ page }) => {
  await page.goto('/page/repro-select-all')
  await page.waitForSelector('.block', { timeout: 15000 })
  await setupBlocks(page, ['AAA', 'BBB', 'CCC'])

  await page.keyboard.press('Control+Shift+a')
  await page.waitForFunction(() => document.querySelectorAll('.block.cb-selected').length >= 3, undefined, { timeout: 8000 })
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => document.querySelectorAll('.block').length <= 1, undefined, { timeout: 10000 })
  await page.waitForTimeout(1500)
  await expectNoResidue(page, 'RESIDUE-BLOCKSEL')
})

test('编辑器内 Ctrl+A 后块全选删除：原生选区必须折叠（用户截图形态）', async ({ page }) => {
  await page.goto('/page/repro-select-all')
  await page.waitForSelector('.block', { timeout: 15000 })
  await setupBlocks(page, ['AAA', 'BBB', 'CCC'])

  // 编辑器内两次 Ctrl+A：块内全文 → 全文档（PM Text/AllSelection，原生 ::selection 在场）
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Control+a')
  await page.waitForTimeout(200)
  // 再块全选 → Backspace：修复前原生选区保持全选，空行行首残留紫带
  await page.keyboard.press('Control+Shift+a')
  await page.waitForFunction(() => document.querySelectorAll('.block.cb-selected').length >= 3, undefined, { timeout: 8000 })
  await page.keyboard.press('Backspace')
  await page.waitForFunction(() => document.querySelectorAll('.block').length <= 1, undefined, { timeout: 10000 })
  await page.waitForTimeout(800)
  await expectNoResidue(page, 'RESIDUE-CTRLA-PLUS-BLOCKSEL')
})

test('末块为空块的块全选删除后不残留', async ({ page }) => {
  await page.goto('/page/repro-select-all')
  await page.waitForSelector('.block', { timeout: 15000 })
  await setupBlocks(page, ['AAA', 'BBB', 'CCC'])
  // 末尾再补一个空块
  await page.keyboard.press('Enter')
  await waitLastActive(page)

  await page.keyboard.press('Control+Shift+a')
  await page.waitForFunction(() => document.querySelectorAll('.block.cb-selected').length >= 4, undefined, { timeout: 8000 })
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => document.querySelectorAll('.block').length <= 1, undefined, { timeout: 10000 })
  await page.waitForTimeout(1500)
  await expectNoResidue(page, 'RESIDUE-EMPTYLAST')
})

test('跨块文本选区全选删除后不残留', async ({ page }) => {
  await page.goto('/page/repro-select-all')
  await page.waitForSelector('.block', { timeout: 15000 })
  await setupBlocks(page, ['AAA', 'BBB', 'CCC'])

  const firstContent = page.locator('.block').first().locator('.block-content')
  const lastContent = page.locator('.block').nth(2).locator('.block-content')
  const b1 = await firstContent.boundingBox()
  const b3 = await lastContent.boundingBox()
  await page.mouse.move(b1!.x + 5, b1!.y + b1!.height / 2)
  await page.mouse.down()
  await page.mouse.move(b3!.x + 5, b3!.y + b3!.height / 2, { steps: 15 })
  await page.mouse.up()
  await page.waitForFunction(() => document.querySelectorAll('.text-selection-rect').length > 0, undefined, { timeout: 8000 })

  await page.keyboard.press('Delete')
  await page.waitForTimeout(1500)

  const r = await readResidue(page)
  console.log('RESIDUE-TEXTSEL', JSON.stringify(r))
  expect(r.textRects.length, 'text-selection-rect 残留').toBe(0)
})

test('文本选区存在时再块全选+删除不残留', async ({ page }) => {
  await page.goto('/page/repro-select-all')
  await page.waitForSelector('.block', { timeout: 15000 })
  await setupBlocks(page, ['AAA', 'BBB', 'CCC'])

  // 先制造文本选区：渲染态跨块拖拽（comind textRange，与上一用例同款可靠手法；
  // 单块内短拖在无头环境系统性不产生选区，不复用）
  const b1 = await page.locator('.block').first().locator('.block-content').boundingBox()
  const b2 = await page.locator('.block').nth(1).locator('.block-content').boundingBox()
  await page.mouse.move(b1!.x + 5, b1!.y + b1!.height / 2)
  await page.mouse.down()
  await page.mouse.move(b2!.x + 60, b2!.y + b2!.height / 2, { steps: 15 })
  await page.mouse.up()
  await page.waitForFunction(() => document.querySelectorAll('.text-selection-rect').length > 0, undefined, { timeout: 8000 })
  // 再 Ctrl+Shift+A 块全选 → Delete
  await page.keyboard.press('Control+Shift+a')
  await page.waitForFunction(() => document.querySelectorAll('.block.cb-selected').length >= 3, undefined, { timeout: 8000 })
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => document.querySelectorAll('.block').length <= 1, undefined, { timeout: 10000 })
  await page.waitForTimeout(1500)

  const r = await readResidue(page)
  console.log('RESIDUE-MIXED', JSON.stringify(r))
  expect(r.textRects.length, 'text-selection-rect 残留').toBe(0)
  expect(r.cbSelected, 'cb-selected 残留').toBe(0)
})

/**
 * 纯 Ctrl+A（不经块选区）——用户实际复现路径。
 *
 * 每块是独立 PM 实例，Ctrl+A 只在活动块内全选；删除交 PM 原生处理（代码明示不接管
 * plain Ctrl+A）。修复前：PM 的 AllSelection 在整篇替换后映射仍非折叠（实测删除后
 * 1.5s 仍 isCollapsed === false，矩形覆盖整行）⇒ 原生 ::selection 罩住清空后的空段落
 * = 用户截图的整行色带。修复：BlockList 在 PM 事务落地后把选区折到末尾收口
 *（collapseResidualNativeSelection）。
 */
test('活动块 Ctrl+A 全选后 Backspace 不残留原生选区色带', async ({ page }) => {
  await page.goto('/page/repro-select-all')
  await page.waitForSelector('.block', { timeout: 15000 })
  await setupBlocks(page, ['AAA', 'BBB', 'CCC'])

  await page.keyboard.press('Control+a')
  await page.waitForTimeout(300)
  await page.keyboard.press('Backspace')
  await page.waitForTimeout(1500)

  const r = await expectNoSelectionResidue(page, 'RESIDUE-CTRLA-BACKSPACE')
  // 活动块（末块）内容应被 PM 清空
  expect(r.blocks[r.blocks.length - 1].text, '活动块内容应已清空').toBe('')
})

/**
 * Ctrl+A×2 升级为整页块全选（每块是独立 PM 实例，原生 Ctrl+A 永远困在活动块内，
 * 不接管则「全文档全选」永不生效）。升级后删除 = 删掉所有块、只留一个空块。
 */
test('Ctrl+A×2 升级为整页块全选，删除后不残留', async ({ page }) => {
  await page.goto('/page/repro-select-all')
  await page.waitForSelector('.block', { timeout: 15000 })
  await setupBlocks(page, ['AAA', 'BBB', 'CCC'])

  await page.keyboard.press('Control+a')
  await page.waitForTimeout(120)
  await page.keyboard.press('Control+a')
  // 升级判据：所有块进入块选区（修复前恒为 0 —— 第二次 Ctrl+A 仍困在活动块内）
  await page.waitForFunction(() => document.querySelectorAll('.block.cb-selected').length >= 3, undefined, { timeout: 8000 })
  // 升级瞬间：第一次 Ctrl+A 留下的块内文本全选必须已撤销（原生 ::selection 不叠加在块选区上）
  const selState = await page.evaluate(() => {
    const s = window.getSelection()
    return { collapsed: s ? s.isCollapsed : null, text: s ? s.toString() : '' }
  })
  expect(selState.collapsed, '升级后块内文本全选应已撤销').toBe(true)
  expect(selState.text, '升级后不应残留选中文本').toBe('')

  await page.keyboard.press('Delete')
  await page.waitForFunction(() => document.querySelectorAll('.block').length <= 1, undefined, { timeout: 10000 })
  await page.waitForTimeout(1200)
  await expectNoResidue(page, 'CTRLA2-ESCALATE-DELETE')
})

/** 单次 Ctrl+A 不得升级（仍是块内全选，交 TipTap 原生） */
test('单次 Ctrl+A 不升级为块全选', async ({ page }) => {
  await page.goto('/page/repro-select-all')
  await page.waitForSelector('.block', { timeout: 15000 })
  await setupBlocks(page, ['AAA', 'BBB', 'CCC'])

  await page.keyboard.press('Control+a')
  await page.waitForTimeout(500)
  const cb = await page.evaluate(() => document.querySelectorAll('.block.cb-selected').length)
  expect(cb, '单次 Ctrl+A 不应进入块选区').toBe(0)
})

/** 超出时间窗的第二次 Ctrl+A 不升级（避免误触发） */
test('间隔超时的第二次 Ctrl+A 不升级为块全选', async ({ page }) => {
  await page.goto('/page/repro-select-all')
  await page.waitForSelector('.block', { timeout: 15000 })
  await setupBlocks(page, ['AAA', 'BBB', 'CCC'])

  await page.keyboard.press('Control+a')
  await page.waitForTimeout(900) // > CTRL_A_ESCALATE_MS(600)
  await page.keyboard.press('Control+a')
  await page.waitForTimeout(500)
  const cb = await page.evaluate(() => document.querySelectorAll('.block.cb-selected').length)
  expect(cb, '超时的第二次 Ctrl+A 不应进入块选区').toBe(0)
})
