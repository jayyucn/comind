/**
 * 代码块 header（折叠 / 语言 / 自动换行 / 复制）不参与拖拽选区 —— 真机(浏览器)回归
 *
 * 背景：header 渲染在 `.block-content` 内部，旧实现把它当正文文本节点：
 * ① 从 header 起拖会启动跨块文本选区（`blockOffsetFromPoint` 命中 header 文本）；
 * ② 端点偏移 0 落在 header 首个文本节点 ⇒ 高亮色带铺到工具栏按钮上；
 * ③ `textContent` 偏移被 header 文本撑长 ⇒ 复制/删除切错字符。
 *
 * 修复：header 标 `data-text-selection-ignore`，`selection-geometry` 的文本遍历 /
 * 端点构造 / 命中判定一律跳过该子树（jsdom 侧由 `selection-geometry.test.ts` 覆盖几何口径）。
 * 这里验证真实布局下的 `elementFromPoint` / 覆盖层矩形——jsdom 无布局，测不到。
 *
 * 运行: `npm run dev`(已起则复用)后 `npx playwright test tests/code-block-header-selection.spec.ts`
 */
import { test, expect, type Page } from '@playwright/test'

async function makeCodeBlock(page: Page): Promise<void> {
  await page.locator('.block').first().click()
  await page.keyboard.type('/code')
  await page.waitForSelector('.slash-command-item', { timeout: 8000 })
  await page.keyboard.press('Enter')
  await page.waitForSelector('.cm-editor', { timeout: 8000 })
  await page.locator('.cm-content').click()
  await page.keyboard.type('const a = 1')
}

test.describe('代码块 header 拖拽选区', () => {
  test.beforeEach(async ({ page }) => {
    const today = new Date().toISOString().split('T')[0]
    await page.goto(`/journal/${today}`)
    await page.waitForSelector('.block', { timeout: 15000 })
    await makeCodeBlock(page)
  })

  test('从 header 起拖 → 不产生文本选区、不选中工具栏文字', async ({ page }) => {
    const header = page.locator('.code-header').first()
    const box = (await header.boundingBox())!
    // hover 让 toolbar 显示，再在「自动换行」位置上按下并往下拖
    await page.mouse.move(box.x + box.width - 90, box.y + box.height / 2)
    await page.mouse.move(box.x + box.width - 60, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 60, box.y + box.height + 90, { steps: 10 })
    await page.mouse.up()

    const rects = await page.locator('.text-selection-rect').count()
    const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '')
    console.log('[start-in-header] rects =', rects, 'selected =', JSON.stringify(selected))
    expect(rects).toBe(0)
    expect(selected).not.toContain('自动换行')
    expect(selected).not.toContain('TypeScript')
  })

  test('从正文起拖过 header → 高亮不覆盖 header', async ({ page }) => {
    const header = page.locator('.code-header').first()
    const headerBox = (await header.boundingBox())!
    const line = page.locator('.cm-line').first()
    const lineBox = (await line.boundingBox())!

    await page.mouse.move(lineBox.x + 20, lineBox.y + lineBox.height / 2)
    await page.mouse.down()
    // 反向拖到 header 上方
    await page.mouse.move(headerBox.x + headerBox.width / 2, headerBox.y + 2, { steps: 10 })
    await page.mouse.up()

    const rects = await page.$$eval('.text-selection-rect', els =>
      els.map(e => {
        const r = e.getBoundingClientRect()
        return { top: r.top, bottom: r.bottom, left: r.left, width: r.width }
      }))
    console.log('[drag-into-header] headerBottom =', headerBox.y + headerBox.height, JSON.stringify(rects))
    for (const r of rects) {
      // 正文在 header 下方：高亮必须整体落在 header 底边之下（不与其相交）
      expect(r.top).toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 0.5)
    }
  })
})
