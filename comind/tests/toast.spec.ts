import { test, expect } from '@playwright/test'

test.describe('Toast 提示功能', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
  })

  test('同 kind 重复插入时显示 Toast 提示', async ({ page }) => {
    const blockContent = page.locator('.block-content').first()
    await blockContent.click()
    await page.waitForTimeout(1000)

    await page.keyboard.type('/')
    await page.waitForTimeout(500)

    await page.locator('.slash-command-menu .slash-command-item', { hasText: 'Schedule' }).click()
    await page.waitForTimeout(500)

    const panel = page.locator('.dtp-panel')
    await expect(panel).toBeVisible()

    await panel.locator('.dtp-calendar-day--today').click()
    await panel.locator('.dtp-btn--confirm').click()

    await page.waitForTimeout(800)

    await page.locator('.ProseMirror').click()
    await page.waitForTimeout(300)

    await page.keyboard.type('/')
    await page.waitForTimeout(500)

    await page.locator('.slash-command-menu .slash-command-item', { hasText: 'Schedule' }).click()
    await page.waitForTimeout(500)

    const toast = page.locator('.toast-item')
    await expect(toast).toBeVisible()
    await expect(toast).toHaveText(/该任务已有计划时间/)

    await toast.waitFor({ state: 'hidden', timeout: 5000 })
  })

  test('不同 kind 允许插入', async ({ page }) => {
    const blockContent = page.locator('.block-content').first()
    await blockContent.click()
    await page.waitForTimeout(1000)

    await page.keyboard.type('/')
    await page.waitForTimeout(500)

    await page.locator('.slash-command-menu .slash-command-item', { hasText: 'Schedule' }).click()
    await page.waitForTimeout(500)

    const panel = page.locator('.dtp-panel')
    await expect(panel).toBeVisible()

    await panel.locator('.dtp-calendar-day--today').click()
    await panel.locator('.dtp-btn--confirm').click()

    await page.waitForTimeout(800)

    await page.locator('.ProseMirror').click()
    await page.waitForTimeout(300)

    await page.keyboard.type('/')
    await page.waitForTimeout(500)

    await page.locator('.slash-command-menu .slash-command-item', { hasText: 'Deadline' }).click()
    await page.waitForTimeout(500)

    await expect(panel).toBeVisible()
    await panel.locator('.dtp-calendar-day--today').click()
    await panel.locator('.dtp-btn--confirm').click()

    await page.waitForTimeout(500)

    const toast = page.locator('.toast-item')
    await expect(toast).toHaveCount(0)
  })

  test('Toast 显示后自动消失', async ({ page }) => {
    const blockContent = page.locator('.block-content').first()
    await blockContent.click()
    await page.waitForTimeout(1000)

    await page.keyboard.type('/')
    await page.waitForTimeout(500)

    await page.locator('.slash-command-menu .slash-command-item', { hasText: 'Schedule' }).click()
    await page.waitForTimeout(500)

    const panel = page.locator('.dtp-panel')
    await expect(panel).toBeVisible()

    await panel.locator('.dtp-calendar-day--today').click()
    await panel.locator('.dtp-btn--confirm').click()

    await page.waitForTimeout(800)

    await page.locator('.ProseMirror').click()
    await page.waitForTimeout(300)

    await page.keyboard.type('/')
    await page.waitForTimeout(500)
    await page.locator('.slash-command-menu .slash-command-item', { hasText: 'Schedule' }).click()
    await page.waitForTimeout(500)

    const toast = page.locator('.toast-item')
    await expect(toast).toBeVisible()

    await toast.waitFor({ state: 'hidden', timeout: 5000 })
    await expect(toast).toHaveCount(0)
  })

  test('Toast 可手动关闭', async ({ page }) => {
    const blockContent = page.locator('.block-content').first()
    await blockContent.click()
    await page.waitForTimeout(1000)

    await page.keyboard.type('/')
    await page.waitForTimeout(500)

    await page.locator('.slash-command-menu .slash-command-item', { hasText: 'Schedule' }).click()
    await page.waitForTimeout(500)

    const panel = page.locator('.dtp-panel')
    await expect(panel).toBeVisible()

    await panel.locator('.dtp-calendar-day--today').click()
    await panel.locator('.dtp-btn--confirm').click()

    await page.waitForTimeout(800)

    await page.locator('.ProseMirror').click()
    await page.waitForTimeout(300)

    await page.keyboard.type('/')
    await page.waitForTimeout(500)
    await page.locator('.slash-command-menu .slash-command-item', { hasText: 'Schedule' }).click()
    await page.waitForTimeout(500)

    const toast = page.locator('.toast-item')
    await expect(toast).toBeVisible()

    const closeBtn = page.locator('.toast-close')
    await closeBtn.click()

    await expect(toast).toHaveCount(0)
  })
})
