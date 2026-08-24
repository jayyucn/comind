import { test, expect } from '@playwright/test'

/**
 * 回归测试：IdeasTodayPanel 的 .today-body 高度应随 BlockList 内容自动撑开。
 *
 * 背景：.today-body 是 .today-card（有界高度的 column flex 容器）的 flex 子项，
 * 默认 flex-shrink: 1 会在内容超高时压缩 body 盒，使其盒高 < 内容高（内容溢出盒外），
 * 表现为“today-body 不随内容撑开”。修复为 flex-shrink: 0 后，body 盒高 = 内容高，
 * 由 .today-card（overflow-y: auto）负责滚动。
 *
 * 断言信号：body.clientHeight（盒内高）>= body.scrollHeight（内容高）。
 * 修复前内容超高时 clientHeight < scrollHeight（红）；修复后两者相等（绿）。
 */
test.describe('IdeasTodayPanel body expansion', () => {
  test('today-body expands with tall block content', async ({ page }) => {
    await page.goto('/ideas')
    await page.waitForSelector('.today-body', { timeout: 20000 })
    // 等 BlockList 首帧渲染
    await page.waitForTimeout(500)

    // 确保至少有一个可输入的 block（空页先双击留白创建）
    const firstContent = page.locator('.today-body .block-content').first()
    if ((await firstContent.count()) === 0) {
      await page.locator('.today-body .block-list').dblclick({ position: { x: 80, y: 60 } })
      await page.waitForSelector('.today-body .block-content', { timeout: 5000 })
    }

    // 创建足够多 block 使内容溢出卡片可视高度（触发 flex-shrink 压缩）
    await page.locator('.today-body .block-content').first().click()
    const LINES = 25
    for (let i = 0; i < LINES; i++) {
      await page.keyboard.type(`expand-line-${i}`)
      await page.keyboard.press('Enter')
    }
    await page.waitForTimeout(800)

    // 核心断言：body 盒高 >= 内容高（容忍 2px 亚像素差）
    const dims = await page.locator('.today-body').evaluate((el) => ({
      client: el.clientHeight,
      scroll: el.scrollHeight,
    }))
    expect(dims.client).toBeGreaterThanOrEqual(dims.scroll - 2)
  })
})
