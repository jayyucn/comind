/**
 * 表格两段式选择（格内选字 ↔ 整格矩形）浏览器回归网。
 *
 * 用户报告：拖拽选择时，光标只在 A 格移动，B 格却被选中。
 * 根因是表格被当成了「行优先拼接的文本流」——从 A 往下拖一点，字符偏移已越过整行后面的 B 格，
 * 且偏移落空时会退化成「块末」。表格数据存在 `format.table`、块 content 为空，
 * 这样的切片既复制不出内容也回写不了。
 *
 * 锚定后的行为（渲染态与编辑态都生效）：
 * 1. 起点在格内、光标不出格 → 只选该格文字（渲染态用原生选区，编辑态用 textarea 原生选区）；
 * 2. 光标出格 → 转为整格矩形选区，行列都含端点，**不再有任何跨格原生文字选区**；
 * 3. 格选区 Ctrl+C 输出 TSV、Delete 清空内容（表结构不变）；
 * 4. 起点在表格外、拖到表格上 → 表格作为原子单元整块入选（一条色带覆盖整表）。
 *
 * 运行：`npm run dev`（已起则复用）后 `npx playwright test tests/table-cell-selection.spec.ts`
 */
import { test, expect, type Page } from '@playwright/test'

const CELLS = ['R0C0', 'R0C1', 'R0C2', 'R1C0', 'R1C1', 'R1C2', 'R2C0', 'R2C1', 'R2C2']

async function cellBox(page: Page, row: number, col: number) {
  const box = await page
    .locator(`.table-block td[data-row="${row}"][data-col="${col}"]`)
    .first()
    .boundingBox()
  if (!box) throw new Error(`量不到格 ${row},${col}`)
  return box
}

/** 格选区色块（块根坐标，按渲染顺序） */
async function cellBoxes(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.cell-select-box')).map((el) => {
      const b = el.getBoundingClientRect()
      return { x: Math.round(b.x), y: Math.round(b.y) }
    }),
  )
}

/** 当前原生文字选区（未折叠时的文本）；格选区形态下必须为空串 */
async function nativeText(page: Page) {
  return page.evaluate(() => {
    const sel = window.getSelection()
    return sel && sel.rangeCount > 0 && !sel.isCollapsed ? sel.toString() : ''
  })
}

/** 当前聚焦元素标签名：出格后必须是 BODY（textarea 撤焦，输入法工具栏才不闪） */
async function activeTag(page: Page) {
  return page.evaluate(() => document.activeElement?.tagName ?? 'NONE')
}

/** 当前聚焦格（仅当聚焦元素是格内 textarea） */
async function focusedCell(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLTextAreaElement | null
    return el?.tagName === 'TEXTAREA' ? [el.dataset.row, el.dataset.col] : null
  })
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(250)
}

test('表格两段式选择：格内只选该格文字，出格转为整格矩形', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForSelector('.block', { timeout: 15000 })
  await page.waitForTimeout(500)

  // ── 夹具：上方一个文本块（供「起点在表格外」用例），下面 3×3 表格填满 ──
  await page.locator('.block').first().click()
  await page.waitForTimeout(300)
  await page.keyboard.type('上面的文字', { delay: 25 })
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  await page.keyboard.type('/table', { delay: 30 })
  await page.waitForTimeout(400)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(800)

  const table = page.locator('.table-block').first()
  await table.waitFor({ timeout: 8000 })
  for (const [i, text] of CELLS.entries()) {
    const row = Math.floor(i / 3)
    const col = i % 3
    await page.locator(`.table-block textarea[data-row="${row}"][data-col="${col}"]`).first().click()
    await page.keyboard.type(text, { delay: 12 })
  }

  // 点表格外退出编辑态 → 渲染态（格内是纯文本 span）
  const t0 = await table.boundingBox()
  if (!t0) throw new Error('量不到表格')
  await page.mouse.click(t0.x + t0.width + 60, t0.y + t0.height + 80)
  await page.waitForTimeout(400)
  await expect(table).toHaveClass(/is-readonly/)

  const A = await cellBox(page, 1, 0)
  const B = await cellBox(page, 1, 1)
  const D = await cellBox(page, 2, 0)

  await test.step('S1 格内拖选：只有该格文字被选中，没有整格色块', async () => {
    await drag(page, { x: A.x + 4, y: A.y + A.height / 2 }, { x: A.x + A.width - 10, y: A.y + A.height / 2 })
    expect(await nativeText(page)).toBe('R1C0')
    expect(await cellBoxes(page)).toHaveLength(0)
  })

  await test.step('S2 竖向出格（A → 下方 D）：整格矩形，无跨格原生选区', async () => {
    await drag(page, { x: A.x + 4, y: A.y + A.height / 2 }, { x: D.x + 20, y: D.y + D.height / 2 })
    // 关键断言：B 格既不在矩形里，也没有被原生选区选中
    expect(await cellBoxes(page)).toHaveLength(2)
    expect(await nativeText(page)).toBe('')
  })

  await test.step('S3 横向出格（A → 右侧 B）：矩形含 B，原生选区被收掉', async () => {
    await drag(page, { x: A.x + 4, y: A.y + A.height / 2 }, { x: B.x + 20, y: B.y + B.height / 2 })
    expect(await cellBoxes(page)).toHaveLength(2)
    expect(await nativeText(page)).toBe('')
  })

  await test.step('S4 反向拖（B → A）：先归一再画，形状与 S3 一致', async () => {
    await drag(page, { x: B.x + B.width - 6, y: B.y + B.height / 2 }, { x: A.x + 6, y: A.y + A.height / 2 })
    const boxes = await cellBoxes(page)
    expect(boxes).toHaveLength(2)
    expect(boxes.map(b => b.y)).toEqual([boxes[0]!.y, boxes[0]!.y])
  })

  await test.step('S5 Ctrl+C 输出 TSV', async () => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.keyboard.press('Control+c')
    await page.waitForTimeout(200)
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('R1C0\tR1C1')
  })

  await test.step('S6 Delete 清空所选格内容，表结构与其他格不变', async () => {
    await page.keyboard.press('Delete')
    await page.waitForTimeout(400)
    const rows = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.table-block tr')).map((tr) =>
        Array.from(tr.querySelectorAll('td')).map((td) => td.textContent ?? ''),
      ),
    )
    expect(rows).toEqual([
      ['R0C0', 'R0C1', 'R0C2'],
      ['', '', 'R1C2'],
      ['R2C0', 'R2C1', 'R2C2'],
    ])
  })

  await test.step('S7 起点在表格外的文本 → 拖到表格上：表格作为原子单元整块入选', async () => {
    const top = await page.locator('.block').first().boundingBox()
    if (!top) throw new Error('量不到首块')
    await drag(page, { x: top.x + 30, y: top.y + 10 }, { x: A.x + 30, y: A.y + A.height / 2 })

    const rects = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.text-selection-rect')).map((el) => {
        const b = el.getBoundingClientRect()
        return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
      }),
    )
    const tableRect = await table.evaluate((el) => {
      const b = el.querySelector('table')!.getBoundingClientRect()
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
    })
    // 覆盖整表的色带：宽度对齐表格，且纵向把表格完整包住
    const cover = rects.find((r) => Math.abs(r.w - tableRect.w) <= 2)
    expect(cover, `色带应有一条整表宽：${JSON.stringify(rects)}`).toBeTruthy()
    expect(cover!.y).toBeLessThanOrEqual(tableRect.y)
    expect(cover!.y + cover!.h).toBeGreaterThanOrEqual(tableRect.y + tableRect.h)
    expect(await cellBoxes(page)).toHaveLength(0)
  })

  await test.step('S8 拖出表格左边界：端点钳到最边上的格，不放开原生选区', async () => {
    await drag(page, { x: A.x + 4, y: A.y + A.height / 2 }, { x: A.x - 80, y: D.y + D.height / 2 })
    expect(await cellBoxes(page)).toHaveLength(2)
    expect(await nativeText(page)).toBe('')
  })

  await test.step('S9 编辑态：单击格激活后焦点落在该格', async () => {
    const probe = await cellBox(page, 1, 1)
    await page.mouse.click(probe.x + 12, probe.y + probe.height / 2)
    await page.waitForTimeout(500)
    await expect(table).not.toHaveClass(/is-readonly/)
    const focus = await page.evaluate(() => {
      const el = document.activeElement as HTMLTextAreaElement | null
      return el?.tagName === 'TEXTAREA' ? [el.dataset.row, el.dataset.col] : null
    })
    expect(focus).toEqual(['1', '1'])
  })

  await test.step('S10 编辑态出格拖拽：整格矩形，且起点格撤焦（否则输入法工具栏一直闪）', async () => {
    const a2 = await cellBox(page, 1, 0)
    const c2 = await cellBox(page, 2, 1)
    await page.mouse.move(a2.x + 4, a2.y + a2.height / 2)
    await page.mouse.down()
    await page.mouse.move(c2.x + 20, c2.y + c2.height / 2, { steps: 12 })
    await page.waitForTimeout(200)
    expect(await cellBoxes(page)).toHaveLength(4) // rows 1-2 × cols 0-1
    // 出格即撤焦：起点格 textarea 不再持焦，浏览器才不会每次 mousemove 都刷新它的选区
    expect(await activeTag(page)).toBe('BODY')
    expect(await nativeText(page)).toBe('')
    // 手势途中继续抖动，焦点也不许回到格内
    await page.mouse.move(c2.x + 36, c2.y + c2.height / 2 - 4, { steps: 6 })
    await page.waitForTimeout(150)
    expect(await activeTag(page)).toBe('BODY')
    await page.mouse.up()
    await page.waitForTimeout(200)
    expect(await activeTag(page)).toBe('BODY')
    expect(await cellBoxes(page)).toHaveLength(4)
  })

  await test.step('S10b 拖出再拖回起点格：手势中不回焦，松手后光标还给该格', async () => {
    const a3 = await cellBox(page, 1, 0)
    const b3 = await cellBox(page, 2, 0)
    await page.mouse.move(a3.x + 6, a3.y + a3.height / 2)
    await page.mouse.down()
    await page.mouse.move(b3.x + 20, b3.y + b3.height / 2, { steps: 10 })
    await page.waitForTimeout(150)
    expect(await activeTag(page)).toBe('BODY')
    await page.mouse.move(a3.x + 30, a3.y + a3.height / 2, { steps: 10 })
    await page.waitForTimeout(150)
    expect(await activeTag(page)).toBe('BODY') // 回格途中不反复 focus —— 那正是闪烁的来源
    await page.mouse.up()
    await page.waitForTimeout(400)
    expect(await cellBoxes(page)).toHaveLength(0)
    expect(await focusedCell(page)).toEqual(['1', '0'])
  })

  await test.step('S11 编辑态格内拖选：textarea 自己选出文字，不产生格选区', async () => {
    const cell = await cellBox(page, 2, 2)
    await page.mouse.click(cell.x + 10, cell.y + cell.height / 2)
    await page.waitForTimeout(400)
    await drag(page, { x: cell.x + 10, y: cell.y + cell.height / 2 }, { x: cell.x + cell.width - 12, y: cell.y + cell.height / 2 })
    expect(await cellBoxes(page)).toHaveLength(0)
    const ta = await page.evaluate(() => {
      const el = document.activeElement as HTMLTextAreaElement | null
      return el?.tagName === 'TEXTAREA' ? { text: el.value.slice(el.selectionStart, el.selectionEnd) } : null
    })
    expect(ta?.text).toBe('R2C2')
  })

  await test.step('S12 格选区态按 Esc：撤选区并退回渲染态（出格后格内 Esc 已收不到）', async () => {
    const a4 = await cellBox(page, 1, 0)
    const c4 = await cellBox(page, 2, 1)
    await drag(page, { x: a4.x + 6, y: a4.y + a4.height / 2 }, { x: c4.x + 20, y: c4.y + c4.height / 2 })
    expect(await cellBoxes(page)).toHaveLength(4)
    expect(await activeTag(page)).toBe('BODY')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    expect(await cellBoxes(page)).toHaveLength(0)
    await expect(table).toHaveClass(/is-readonly/)
  })
})
