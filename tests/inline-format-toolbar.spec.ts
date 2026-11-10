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
  await toolbar.locator('button[title="文字颜色"]').click()
  await toolbar
    .locator('.inline-format-palette-grid .inline-format-swatch:not(.inline-format-swatch--none)')
    .first()
    .click()
  await page.waitForTimeout(400)

  const colored = await page.evaluate(() => {
    const el = document.querySelector('.block.active .tiptap')
    return el?.querySelectorAll('[data-inline-color]').length ?? 0
  })
  expect(colored, '编辑态应渲染带 data-inline-color 的 span').toBeGreaterThan(0)
})

test('全选文本时工具条应贴在文字上方', async ({ page }) => {
  await page.goto('/page/repro-inline-format')
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
