import { test, expect } from '@playwright/test'

test.describe('DateTimePickerPanel - 点击外部关闭', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)
  })

  async function openDatePicker(page: any) {
    const blockContent = page.locator('.block-content').first()
    await blockContent.click()
    await page.waitForTimeout(1000)

    await page.keyboard.type('/')
    await page.waitForTimeout(500)

    const scheduleItem = page.locator('.slash-command-menu .slash-command-item', { hasText: 'Schedule' })
    await scheduleItem.click()

    await page.waitForTimeout(800)

    const panel = page.locator('.dtp-panel')
    await expect(panel).toBeVisible()
    return panel
  }

  test('右上角 X 按钮已被移除', async ({ page }) => {
    const panel = await openDatePicker(page)

    // X 按钮不应该存在
    const closeButton = panel.locator('.dtp-icon-btn').filter({ has: page.locator('svg') })
    const closeBtnCount = await closeButton.count()
    expect(closeBtnCount).toBe(0)
  })

  test('点击 panel 外部（overlay 区域）关闭面板', async ({ page }) => {
    const panel = await openDatePicker(page)
    await expect(panel).toBeVisible()

    // 点击 panel 左上角（panel 外部）
    await page.mouse.click(1, 1)
    await page.waitForTimeout(300)

    // panel 应该消失
    await expect(panel).not.toBeVisible()
  })

  test('点击 panel 内部区域保持打开', async ({ page }) => {
    const panel = await openDatePicker(page)
    await expect(panel).toBeVisible()

    // 点击 panel 内部的日期选择区
    const calendarDay = panel.locator('.dtp-calendar-day').first()
    await calendarDay.click()
    await page.waitForTimeout(300)

    // panel 应该仍然可见
    await expect(panel).toBeVisible()
  })

  test('点击面板内的确定按钮正常关闭', async ({ page }) => {
    const panel = await openDatePicker(page)
    await expect(panel).toBeVisible()

    // 先选一个日期
    const calendarDay = panel.locator('.dtp-calendar-day').nth(15)
    await calendarDay.click()
    await page.waitForTimeout(200)

    // 点击确定按钮
    const confirmBtn = panel.locator('.dtp-btn--confirm')
    await confirmBtn.click()
    await page.waitForTimeout(300)

    // panel 应该消失
    await expect(panel).not.toBeVisible()
  })

  test('点击面板内的取消按钮关闭', async ({ page }) => {
    const panel = await openDatePicker(page)
    await expect(panel).toBeVisible()

    // 点击取消按钮
    const cancelBtn = panel.locator('.dtp-btn--cancel')
    await cancelBtn.click()
    await page.waitForTimeout(300)

    // panel 应该消失
    await expect(panel).not.toBeVisible()
  })

  test('Escape 键关闭面板', async ({ page }) => {
    const panel = await openDatePicker(page)
    await expect(panel).toBeVisible()

    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    await expect(panel).not.toBeVisible()
  })

  test('切换类型按钮仍然存在（保留在标题旁）', async ({ page }) => {
    const panel = await openDatePicker(page)

    // 标题区域仍然显示（可能保留类型切换功能）
    const kindSelect = panel.locator('.dtp-kind-select')
    await expect(kindSelect).toBeVisible()
  })

  test('从 schedule 切换到 deadline 时清空重复选项', async ({ page }) => {
    const panel = await openDatePicker(page)
    await expect(panel).toBeVisible()

    // 选择日期
    await panel.locator('.dtp-calendar-day--today').click()
    await page.waitForTimeout(200)

    // 设置重复
    const select = panel.locator('.dtp-input--select')
    await select.selectOption('weekly')
    await page.waitForTimeout(200)

    // 确认 recurrence 被设置
    const previewText = await panel.locator('.dtp-preview').innerText()
    expect(previewText).toContain('每周')

    // 切换到 deadline
    await panel.locator('.dtp-kind-select').selectOption('deadline')
    await page.waitForTimeout(300)

    // 重复选择器应该消失
    await expect(panel.locator('.dtp-input--select')).not.toBeVisible()

    // preview 中不应包含重复文字
    const previewAfter = await panel.locator('.dtp-preview').innerText()
    expect(previewAfter).not.toContain('每天')
    expect(previewAfter).not.toContain('每周')
    expect(previewAfter).not.toContain('每月')
    expect(previewAfter).not.toContain('每年')
  })

  test('从 deadline 切换回 schedule 时恢复重复选项', async ({ page }) => {
    const blockContent = page.locator('.block-content').first()
    await blockContent.click()
    await page.waitForTimeout(1000)

    await page.keyboard.type('/')
    await page.waitForTimeout(500)

    const deadlineItem = page.locator('.slash-command-menu .slash-command-item', { hasText: 'Deadline' })
    await deadlineItem.click()

    await page.waitForTimeout(800)

    const panel = page.locator('.dtp-panel')
    await expect(panel).toBeVisible()

    // 重复选择器不存在
    await expect(panel.locator('.dtp-input--select')).not.toBeVisible()

    // 切换到 schedule
    await panel.locator('.dtp-kind-select').selectOption('schedule')
    await page.waitForTimeout(300)

    // 重复选择器应该出现
    await expect(panel.locator('.dtp-input--select')).toBeVisible()
  })
})
