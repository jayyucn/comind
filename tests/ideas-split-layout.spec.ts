import { test, expect } from '@playwright/test'

test.describe('IdeasList Split Layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/ideas')
    await page.waitForSelector('.ideas-split-view', { timeout: 10000 })
  })

  test('left column displays today panel', async ({ page }) => {
    const todayPanel = page.locator('.today-panel')
    await expect(todayPanel).toBeVisible()
    await expect(todayPanel.locator('.today-badge')).toContainText('今天')
  })

  test('right column displays history list', async ({ page }) => {
    const historyList = page.locator('.history-list')
    await expect(historyList).toBeVisible()
    await expect(historyList.locator('.history-sticky-header')).toContainText('历史')
  })

  test('left column has editable indicator', async ({ page }) => {
    const todayLabel = page.locator('.today-label')
    await expect(todayLabel).toContainText('可编辑')
  })

  test('right column shows empty state when no history', async ({ page }) => {
    const historyList = page.locator('.history-list')
    const hasItems = await historyList.locator('.history-item').count()
    if (hasItems === 0) {
      await expect(historyList.locator('.empty-text')).toContainText('暂无历史点滴')
    }
  })

  test('history header renders MonthPicker with exactly one selected month', async ({ page }) => {
    const picker = page.locator('.history-sticky-header .month-picker')
    await expect(picker).toBeVisible()
    // 12 个月份格
    await expect(picker.locator('.mp-cell')).toHaveCount(12)
    // 恰好一个选中月份格（默认本月，或自动跳到的最近有数据月）
    await expect(picker.locator('.mp-cell.is-selected')).toHaveCount(1)
  })

  test('selecting an old empty month filters history list to empty state', async ({ page }) => {
    const historyList = page.locator('.history-list')
    const picker = historyList.locator('.month-picker')
    await expect(picker).toBeVisible()
    // 翻到 2000 年（无论起始年份，点 prevYear 直到年份标签为 2000年）
    const prevBtn = picker.locator('.mp-nav[aria-label="上一年"]')
    for (let i = 0; i < 100; i++) {
      const label = await picker.locator('.mp-year-label').textContent()
      if (label?.includes('2000年')) break
      await prevBtn.click()
    }
    await expect(picker.locator('.mp-year-label')).toContainText('2000年')
    // 点击 1月（精确匹配，避免命中 11月）
    await picker.locator('.mp-cell').filter({ hasText: /^1月$/ }).click()
    // 2000-01 预期无数据 → 空态
    await expect(historyList.locator('.empty-text')).toContainText('暂无历史点滴')
  })
})
