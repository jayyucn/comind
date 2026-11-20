/**
 * 「选区转为页面引用」端到端回归（D1/D2/D3/D5/D7）。
 *
 * 三个面各一条：
 * 1. 单块合法选区 → 按钮可点，包裹后渲染成 `data-page` 链接、浮条关闭（收场）；
 * 2. 单块非法选区（含 `|`）→ 按钮置灰并给出判据；
 * 3. 跨块选区 → 按钮不渲染（能力永不成立，置灰会误导用户去改文本）。
 *
 * 运行：`npm run dev`（或由 playwright 自起）后
 * `npx playwright test tests/wrap-page-ref.spec.ts`
 */
import { expect, test, type Page } from '@playwright/test'

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

const activeText = (page: Page) =>
  page.evaluate(() => document.querySelector('.block.active .tiptap')?.textContent ?? '')

/** 打字 + 校验（编辑器挂载竞态会把首字吞掉） */
async function typeIntoActiveBlock(page: Page, text: string) {
  await page.keyboard.type(text, { delay: 25 })
  for (let i = 0; i < 5; i += 1) {
    if ((await activeText(page)) === text) return
    const missing = text.slice((await activeText(page)).length)
    if (missing) await page.keyboard.type(missing, { delay: 25 })
    await page.waitForTimeout(150)
  }
  expect(await activeText(page)).toBe(text)
}

/** 量出某块内一段子串的屏幕矩形（用于按字符拖选） */
async function rectOfSubstring(page: Page, blockText: string, from: number, to: number) {
  const rect = await page.evaluate(({ blockText, from, to }) => {
    const el = [...document.querySelectorAll('.block-content')]
      .find(node => node.textContent?.includes(blockText))
    if (!el) return null
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode() as Text | null
    while (node && !node.nodeValue?.includes(blockText)) node = walker.nextNode() as Text | null
    if (!node || !node.nodeValue) return null
    const start = node.nodeValue.indexOf(blockText) + from
    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(node, start + (to - from))
    const r = range.getBoundingClientRect()
    return { left: r.left, top: r.top, width: r.width, height: r.height }
  }, { blockText, from, to })
  if (!rect) throw new Error(`量不到「${blockText}」[${from},${to})`)
  return rect
}

/** 块级横拖：位移必须 ≥ 4px 才会从「点」升级为「文本拖选」（ADR-0035 D2） */
async function dragWithin(page: Page, rect: { left: number; top: number; width: number; height: number }) {
  const y = rect.top + rect.height / 2
  await page.mouse.move(rect.left + 1, y)
  await page.mouse.down()
  await page.mouse.move(rect.left + rect.width - 1, y, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(350)
}

test('单块合法选区：点按钮把文字包成 [[页名]] 并收场', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await page.waitForSelector('.block', { timeout: 15000 })
  await page.locator('.block').first().click()
  await waitActiveBlock(page, 0)

  // 推到视口中部，浮条上方才有空间（贴近视口顶时按规则翻到下方，不影响功能，但更难断言）
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('Enter')
  await page.waitForTimeout(200)
  await typeIntoActiveBlock(page, '我看项目A了')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  // 选中「项目A」（下标 2..5）
  const rect = await rectOfSubstring(page, '我看项目A了', 2, 5)
  await dragWithin(page, rect)

  const toolbar = page.locator('.inline-format-toolbar')
  await expect(toolbar).toBeVisible({ timeout: 4000 })
  const button = toolbar.locator('button[aria-label="转为页面引用"]')
  await expect(button).toBeVisible()
  await expect(button).toBeEnabled()

  await button.click()
  await page.waitForTimeout(1000)

  // 内容：中段选区两侧按 inline-unit-pad 补空，与「[[ 补全插页」同字面
  const editorText = await page.evaluate(
    () => document.querySelector('.block.active .tiptap p')?.textContent ?? '',
  )
  expect(editorText).toBe('我看 [[项目A]] 了')

  // 收场：浮条关闭、选区结束、光标落回块内（可直接接着写）
  await expect(page.locator('.inline-format-toolbar')).toHaveCount(0)
  const caret = await page.evaluate(() => ({
    collapsed: !!window.getSelection()?.isCollapsed,
    inEditor: !!(document.activeElement as HTMLElement | null)?.closest('.tiptap'),
  }))
  expect(caret.collapsed, '选区应结束（折叠光标）').toBe(true)
  expect(caret.inEditor, '光标应落在块内').toBe(true)

  // 渲染态：`data-page` chip 来自 Rust 的 link 段 —— 说明页面已建、link 行已写
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
  await expect(page.locator('.block-content .block-link[data-page="项目A"]')).toHaveCount(1)
})

test('单块非法选区（含 |）：按钮置灰并给出判据', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await page.waitForSelector('.block', { timeout: 15000 })
  await page.locator('.block').first().click()
  await waitActiveBlock(page, 0)

  for (let i = 0; i < 6; i += 1) await page.keyboard.press('Enter')
  await page.waitForTimeout(200)
  await typeIntoActiveBlock(page, 'aa|bb')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  const rect = await rectOfSubstring(page, 'aa|bb', 0, 5)
  await dragWithin(page, rect)

  const toolbar = page.locator('.inline-format-toolbar')
  await expect(toolbar).toBeVisible({ timeout: 4000 })
  const button = toolbar.locator('button[aria-label="转为页面引用"]')
  await expect(button).toBeVisible()
  await expect(button).toBeDisabled()
  // 点名具体字符，而不是「含 | [ ] 或换行」这种让人逐个试的说法
  await expect(button).toHaveAttribute('title', '选区不能作为页面名，不能包含「|」')
})

/**
 * 用户诉求的原例：选中 `[页面` 时要说清是 `[` 不行。
 * 反例（旧实现）：一律回「含 | [ ] 或换行，或只有空白」。
 */
test('含 [ 的选区：提示点名「[」', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await page.waitForSelector('.block', { timeout: 15000 })
  await page.locator('.block').first().click()
  await waitActiveBlock(page, 0)

  for (let i = 0; i < 6; i += 1) await page.keyboard.press('Enter')
  await page.waitForTimeout(200)
  // `[` 会被括号配对自动补成 `[]`，删掉自动补的 `]` 才能构造出只剩单边 `[` 的文本
  await page.keyboard.type('看[', { delay: 25 })
  await page.keyboard.type('页面', { delay: 25 })
  await page.keyboard.press('Delete')
  await page.waitForTimeout(200)
  expect((await activeText(page)).replace(/\u200B/g, '')).toBe('看[页面')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  const rect = await rectOfSubstring(page, '看[页面', 1, 4)
  await dragWithin(page, rect)

  const button = page.locator('.inline-format-toolbar button[aria-label="转为页面引用"]')
  await expect(button).toBeVisible({ timeout: 4000 })
  await expect(button).toBeDisabled()
  await expect(button).toHaveAttribute('title', '选区不能作为页面名，不能包含「[」')
})

test('键盘选区（编辑态）：同一个按钮同样可用', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await page.waitForSelector('.block', { timeout: 15000 })
  await page.locator('.block').first().click()
  await waitActiveBlock(page, 0)

  for (let i = 0; i < 6; i += 1) await page.keyboard.press('Enter')
  await page.waitForTimeout(200)
  await typeIntoActiveBlock(page, '我看项目A了')

  // 键盘选「项目A」：行尾 → Shift+左 3（不按手势分化，D1）
  await page.keyboard.press('End')
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('Shift+ArrowLeft')
  await page.waitForTimeout(250)

  const toolbar = page.locator('.inline-format-toolbar')
  await expect(toolbar).toBeVisible({ timeout: 4000 })
  const button = toolbar.locator('button[aria-label="转为页面引用"]')
  await expect(button).toBeEnabled()
  await button.click()
  await page.waitForTimeout(600)

  const editorText = await page.evaluate(
    () => document.querySelector('.block.active .tiptap p')?.textContent ?? '',
  )
  // 尾部选区：「目A了」被包起来，左侧按 inline-unit-pad 补一个空格（与补全插页同口径）
  expect(editorText).toBe('我看项 [[目A了]] ')
})

test('跨块选区：按钮不渲染', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await page.waitForSelector('.block', { timeout: 15000 })
  await page.locator('.block').first().click()
  await waitActiveBlock(page, 0)

  await typeIntoActiveBlock(page, 'alpha cross one')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(200)
  await typeIntoActiveBlock(page, 'beta cross two')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  const first = await rectOfSubstring(page, 'alpha cross one', 0, 5)
  const last = await rectOfSubstring(page, 'beta cross two', 0, 4)
  await page.mouse.move(first.left + 1, first.top + first.height / 2)
  await page.mouse.down()
  await page.mouse.move(first.left + 40, first.top + first.height / 2, { steps: 4 })
  await page.mouse.move(last.left + 30, last.top + last.height / 2, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(400)

  const toolbar = page.locator('.inline-format-toolbar')
  await expect(toolbar).toBeVisible({ timeout: 4000 })
  await expect(toolbar.locator('button[aria-label="转为页面引用"]')).toHaveCount(0)
})

/**
 * 提交 A 的端到端证据：手打 `[[X]]` 后失焦（提交时点）→ 目标页被创建、link 行写入。
 *
 * 渲染态的 `data-page` chip 由 Rust 用 **link 行** + Page 表组装（render_segment_service），
 * 所以 chip 出现即证明「页面存在 + link 行存在」，不只是文本长得像链接。
 */
test('手打 [[X]] 失焦：建页并写 link（渲染成真链接）', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await page.waitForSelector('.block', { timeout: 15000 })
  await page.locator('.block').first().click()
  await waitActiveBlock(page, 0)

  for (let i = 0; i < 6; i += 1) await page.keyboard.press('Enter')
  await page.waitForTimeout(200)

  // `[[` 会自动补成 `[[]]`（BracketPairExtension），光标落在括号内 ⇒ 直接打名字即可
  await page.keyboard.type('see ', { delay: 30 })
  await page.keyboard.type('[[', { delay: 60 })
  await page.waitForTimeout(200)
  await page.keyboard.type('手打建页回归', { delay: 30 })
  await page.waitForTimeout(200)
  // 块尾有零宽锚点 widget（inline-unit-keyboard），比对前剔除
  expect((await activeText(page)).replace(/\u200B/g, '')).toBe('see [[手打建页回归]]')

  // 失焦 = 提交动作（commitTags true），此时才允许建页
  // 第一次 Esc 关 `[[` 补全菜单，第二次 Esc 退出编辑态
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1200)

  await expect(page.locator('.block-content .block-link[data-page="手打建页回归"]')).toHaveCount(1)
})
