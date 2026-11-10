/**
 * 行内富文本（inline format）回归测试：
 * 1. 编辑态应能看到文字色/背景色（此前 mark 渲染读不到 color 属性，编辑态只剩裸 span）
 * 2. 全选文本时工具条应贴在文字上方（此前 Ctrl+A 的端点落在段落节点边界，
 *    coordsAtPos 返回整行行盒，工具条被横向拉到行中间）
 */
import { test, expect, type Page } from '@playwright/test'

async function waitActiveBlock(page: Page, index: number) {
  await page.waitForFunction(
    (i) => {
      const blocks = document.querySelectorAll('.block')
      const block = blocks[i]
      return !!block && block.classList.contains('active') && block.contains(document.activeElement)
    },
    index,
    { timeout: 8000 },
  )
}

async function typeIntoActiveBlock(page: Page, text: string) {
  await page.keyboard.type(text, { delay: 20 })
  for (let i = 0; i < 3; i++) {
    const current = await page.evaluate(() => document.querySelector('.block.active .tiptap')?.textContent ?? null)
    if (current === text) return
    const missing = text.slice(current?.length ?? 0)
    if (missing) await page.keyboard.type(missing, { delay: 20 })
    await page.waitForTimeout(150)
  }
}

test('编辑态应显示行内文字色', async ({ page }) => {
  await page.goto('/page/repro-inline-format')
  await page.waitForSelector('.block', { timeout: 15000 })
  await page.locator('.block').first().click()
  await waitActiveBlock(page, 0)
  await typeIntoActiveBlock(page, 'color test')

  await page.keyboard.press('Control+a')
  const toolbar = page.locator('.inline-format-toolbar')
  await expect(toolbar).toBeVisible({ timeout: 4000 })
  await toolbar.locator('button[title="文字颜色与背景色"]').click()
  // 取色面板是 Teleport 出去的二级浮层，不再是工具条的 DOM 后代
  await page
    .locator('.inline-format-palette-section[data-kind="color"] .inline-format-swatch--text:not(.inline-format-swatch--default)')
    .first()
    .click()
  await page.waitForTimeout(400)

  const colored = await page.evaluate(() => {
    const el = document.querySelector('.block.active .tiptap')
    return el?.querySelectorAll('[data-inline-color]').length ?? 0
  })
  expect(colored, '编辑态应渲染带 data-inline-color 的 span').toBeGreaterThan(0)
})

test('全选文本时工具条应贴在文字上方', async ({ page }) => {  await page.goto('/page/repro-inline-format')
  await page.waitForSelector('.block', { timeout: 15000 })
  await page.locator('.block').first().click()
  await waitActiveBlock(page, 0)
  await typeIntoActiveBlock(page, 'hello world')

  await page.keyboard.press('Control+a')
  const toolbar = page.locator('.inline-format-toolbar')
  await expect(toolbar).toBeVisible({ timeout: 4000 })
  await page.waitForTimeout(200)

  const toolbarBox = (await toolbar.boundingBox())!
  const textBox = await page.evaluate(() => {
    const el = document.querySelector('.block.active .tiptap p')
    if (!el) return null
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let first: Text | null = null
    let last: Text | null = null
    let node = walker.nextNode() as Text | null
    while (node) {
      if (node.nodeValue) {
        first ??= node
        last = node
      }
      node = walker.nextNode() as Text | null
    }
    if (!first || !last) return null
    const range = document.createRange()
    range.setStart(first, 0)
    range.setEnd(last, last.length)
    const rect = range.getBoundingClientRect()
    return { left: rect.left, right: rect.right, top: rect.top }
  })
  expect(textBox).not.toBeNull()

  const gap = textBox!.top - (toolbarBox.y + toolbarBox.height)
  expect(gap, '工具条底边应贴近文字顶部').toBeGreaterThan(-10)
  expect(gap, '工具条不应远离文字').toBeLessThan(60)

  const centerDelta = Math.abs(
    toolbarBox.x + toolbarBox.width / 2 - (textBox!.left + textBox!.right) / 2,
  )
  expect(centerDelta, '工具条应水平居中于文字上方').toBeLessThan(40)
})

/**
 * 对齐是**块级**能力（`block.format.align`），不是行内 mark：作用对象是整块正文。
 * 这里锚定三件事：工具条上有对齐项、二级下拉浮在工具条**上方**、选完两态都居中。
 */
test('文本工具条带对齐项：下拉浮在工具条上方，选居中后两态都居中', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/page/repro-inline-format')
  await page.waitForSelector('.block', { timeout: 15000 })
  await page.locator('.block').first().click()
  await waitActiveBlock(page, 0)
  // 先把目标块推到视口下半部，上方才有空间挂二级下拉（贴着视口顶会按规则翻到下方）
  for (let i = 0; i < 8; i += 1) await page.keyboard.press('Enter')
  await page.waitForTimeout(200)
  await typeIntoActiveBlock(page, 'align me')

  await page.keyboard.press('Control+a')
  const toolbar = page.locator('.inline-format-toolbar')
  await expect(toolbar).toBeVisible({ timeout: 4000 })
  const alignBtn = toolbar.locator('button[aria-label="对齐方式"]')
  await expect(alignBtn).toBeVisible()
  const toolbarBoxBefore = (await toolbar.boundingBox())!

  await alignBtn.click()
  const menu = page.locator('.align-menu')
  await expect(menu).toBeVisible()
  await page.waitForTimeout(200)
  // 与表格选区浮层同一套：二级在上面，不压住目标
  const menuBox = (await menu.boundingBox())!
  const btnBox = (await alignBtn.boundingBox())!
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(btnBox.y + 2)
  expect(await menu.locator('.align-item').allInnerTexts()).toEqual(['左对齐', '居中对齐', '右对齐'])

  await page.locator('.align-item', { hasText: '居中对齐' }).click()
  await page.waitForTimeout(400)
  // 对齐会让正文横向重排：工具条必须跟着走（编辑态的坐标来自 coordsAtPos，
  // 选区的 from/to 没变、revision 不动，只靠那个 watch 会停在旧位置）
  const toolbarBoxAfter = (await toolbar.boundingBox())!
  expect(toolbarBoxAfter.x, '工具条应跟随文字右移').toBeGreaterThan(toolbarBoxBefore.x + 20)
  expect(await page
    .locator('.block.active .block-content')
    .first()
    .evaluate(el => getComputedStyle(el).textAlign)).toBe('center')
  await expect(menu).toHaveCount(0)

  // 退出编辑态：渲染态读同一份 format.align（不是只在编辑态生效）
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  const rendered = await page.evaluate(() => {
    const target = [...document.querySelectorAll('.block-content')]
      .find(el => el.textContent?.includes('align me'))
    return target ? getComputedStyle(target).textAlign : null
  })
  expect(rendered, '渲染态应保持居中').toBe('center')
})

/**
 * 跨块文本选区（BlockList 自有 textRange，编辑器已失活）下的对齐：
 * 二级浮层 Teleport 到 body 后属于「工具条的一部分」，点它不能被当成「点选区外」
 * 把 textRange 清掉 —— 否则点「居中」时 rangeSegments 当场变空，等于空点。
 */
test('跨块文本选区：对齐作用于覆盖到的每一块', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await page.waitForSelector('.block', { timeout: 15000 })
  await page.locator('.block').first().click()
  await waitActiveBlock(page, 0)

  const activeText = () =>
    page.evaluate(() => document.querySelector('.block.active .tiptap')?.textContent ?? '')
  /** 先整行打一遍；丢了字符就全选重打（补打会和 input 事件抢跑，把尾巴复制一遍） */
  const typeLine = async (text: string) => {
    await page.keyboard.type(text, { delay: 10 })
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (await activeText() === text) return
      await page.keyboard.press('Control+a')
      await page.keyboard.type(text, { delay: 20 })
      await page.waitForTimeout(120)
    }
    expect(await activeText()).toBe(text)
  }

  const lines = ['alpha cross one', 'beta cross two']
  for (let i = 0; i < lines.length; i += 1) {
    if (i > 0) await page.keyboard.press('Enter')
    await typeLine(lines[i]!)
  }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  await expect(page.locator('.block.active')).toHaveCount(0)

  const boxOf = async (text: string) => {
    const box = await page.evaluate((needle) => {
      const el = [...document.querySelectorAll('.block-content')]
        .find(node => node.textContent?.includes(needle))
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.left, y: r.top, w: r.width, h: r.height }
    }, text)
    if (!box) throw new Error(`量不到「${text}」`)
    return box
  }

  const first = await boxOf(lines[0]!)
  const last = await boxOf(lines[1]!)
  await page.mouse.move(first.x + 6, first.y + first.h / 2)
  await page.mouse.down()
  await page.mouse.move(first.x + 40, first.y + first.h / 2, { steps: 4 })
  await page.mouse.move(last.x + 80, last.y + last.h / 2, { steps: 14 })
  await page.mouse.up()
  await page.waitForTimeout(400)

  const toolbar = page.locator('.inline-format-toolbar')
  await expect(toolbar).toBeVisible()
  // 选区确实跨了两块（多行高亮带）
  await expect(page.locator('.text-selection-rect')).toHaveCount(2)
  const toolbarBoxBefore = (await toolbar.boundingBox())!
  await toolbar.locator('button[aria-label="对齐方式"]').click()
  await expect(page.locator('.align-menu')).toBeVisible()
  await page.locator('.align-item', { hasText: '居中对齐' }).click()
  await page.waitForTimeout(600)

  const aligns = await page.evaluate((needles) =>
    [...document.querySelectorAll('.block-content')]
      .filter(el => needles.some(n => el.textContent?.includes(n)))
      .map(el => getComputedStyle(el).textAlign), lines)
  expect(aligns, '覆盖到的每一块都应居中').toEqual(['center', 'center'])

  // 蓝带与工具条都是「拖拽时量的 DOM 矩形」：对齐把正文横向挪走后必须重量，
  // 否则文字已经居中、色带与浮层却钉在旧坐标（本用例就是这条回归网）。
  const follow = await page.evaluate(() => {
    /** 每块第一段文字的墨迹左缘（块级元素宽度不变，只有文字位移） */
    const inks: Array<number | null> = []
    for (const el of document.querySelectorAll('.block-content')) {
      if (!el.textContent?.includes('cross')) continue
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.nodeValue?.trim()) continue
        const range = document.createRange()
        range.selectNodeContents(node)
        const rect = range.getClientRects()[0]
        if (rect) { inks.push(Math.round(rect.left)); break }
      }
    }
    const bars = [...document.querySelectorAll('.text-selection-rect')]
      .map(el => Math.round(el.getBoundingClientRect().left))
    return { inks, bars }
  })
  expect(follow.bars).toHaveLength(follow.inks.length)
  follow.bars.forEach((left, i) => {
    expect(Math.abs(left - (follow.inks[i] ?? left)), `第 ${i} 行蓝带应贴住文字`).toBeLessThanOrEqual(3)
  })
  expect((await toolbar.boundingBox())!.x, '工具条应跟随文字右移').toBeGreaterThan(toolbarBoxBefore.x + 20)
})
