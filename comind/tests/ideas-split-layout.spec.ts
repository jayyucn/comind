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
})
