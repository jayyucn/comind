import { test, expect } from '@playwright/test'

test.describe('Slash Commands - Date/Schedule/Deadline', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
  })

  test('/date inserts WikiLink [[YYYY-MM-DD]]', async ({ page }) => {
    const blockContent = page.locator('.block-content').first()
    await blockContent.click()
    await page.waitForTimeout(1000)
    
    await page.keyboard.type('/')
    await page.waitForTimeout(500)
    
    const dateItem = page.locator('.slash-command-menu .slash-command-item', { hasText: 'Date' })
    await dateItem.click()
    
    await page.waitForTimeout(500)
    
    const content = await page.locator('.block-content').first().innerText()
    expect(content).toMatch(/\[\[2026-\d{2}-\d{2}\]\]/)
  })

  test('/schedule opens DateTimePickerPanel', async ({ page }) => {
    const blockContent = page.locator('.block-content').first()
    await blockContent.click()
    await page.waitForTimeout(1000)
    
    await page.keyboard.type('/')
    await page.waitForTimeout(500)
    
    const scheduleItem = page.locator('.slash-command-menu .slash-command-item', { hasText: 'Schedule' })
    await scheduleItem.click()
    
    await page.waitForTimeout(500)
    
    const panel = page.locator('.dtp-panel')
    await expect(panel).toBeVisible()
    
    const title = await panel.locator('.dtp-title').innerText()
    expect(title).toContain('计划时间')
  })

  test('/deadline opens DateTimePickerPanel', async ({ page }) => {
    const blockContent = page.locator('.block-content').first()
    await blockContent.click()
    await page.waitForTimeout(1000)
    
    await page.keyboard.type('/')
    await page.waitForTimeout(500)
    
    const deadlineItem = page.locator('.slash-command-menu .slash-command-item', { hasText: 'Deadline' })
    await deadlineItem.click()
    
    await page.waitForTimeout(500)
    
    const panel = page.locator('.dtp-panel')
    await expect(panel).toBeVisible()
    
    const title = await panel.locator('.dtp-title').innerText()
    expect(title).toContain('截止时间')
  })

  test('DateTimePickerPanel has correct controls', async ({ page }) => {
    const blockContent = page.locator('.block-content').first()
    await blockContent.click()
    await page.waitForTimeout(1000)
    
    await page.keyboard.type('/')
    await page.waitForTimeout(500)
    
    const scheduleItem = page.locator('.slash-command-menu .slash-command-item', { hasText: 'Schedule' })
    await scheduleItem.click()
    
    await page.waitForTimeout(500)
    
    const panel = page.locator('.dtp-panel')
    await expect(panel).toBeVisible()
    
    await expect(panel.locator('.dtp-calendar')).toBeVisible()
    await expect(panel.locator('.dtp-calendar-grid')).toBeVisible()
    await expect(panel.locator('.dtp-calendar-day')).toHaveCount(42)
    
    await expect(panel.locator('.dtp-calendar-day--today')).toBeVisible()
    await expect(panel.locator('.dtp-calendar-day--selected')).toBeVisible()
    
    await expect(panel.locator('.dtp-checkbox')).toBeVisible()
    await expect(panel.locator('.dtp-input--select')).toBeVisible()
    
    await expect(panel.locator('.dtp-btn--cancel')).toBeVisible()
    await expect(panel.locator('.dtp-btn--confirm')).toBeVisible()
  })

  test('DateTimePickerPanel can select date and confirm', async ({ page }) => {
    const blockContent = page.locator('.block-content').first()
    await blockContent.click()
    await page.waitForTimeout(1000)
    
    await page.keyboard.type('/')
    await page.waitForTimeout(500)
    
    const scheduleItem = page.locator('.slash-command-menu .slash-command-item', { hasText: 'Schedule' })
    await scheduleItem.click()
    
    await page.waitForTimeout(500)
    
    const panel = page.locator('.dtp-panel')
    await expect(panel).toBeVisible()
    
    await panel.locator('.dtp-calendar-day--today').click()
    await panel.locator('.dtp-btn--confirm').click()
    
    await page.waitForTimeout(500)
    
    const content = await page.locator('.block-content').first().innerText()
    expect(content).toMatch(/\{\{schedule:\d{4}-\d{2}-\d{2}\}\}/)
  })

  test('DateTimePickerPanel can select recurrence', async ({ page }) => {
    const blockContent = page.locator('.block-content').first()
    await blockContent.click()
    await page.waitForTimeout(1000)
    
    await page.keyboard.type('/')
    await page.waitForTimeout(500)
    
    const deadlineItem = page.locator('.slash-command-menu .slash-command-item', { hasText: 'Deadline' })
    await deadlineItem.click()
    
    await page.waitForTimeout(500)
    
    const panel = page.locator('.dtp-panel')
    await expect(panel).toBeVisible()
    
    await panel.locator('.dtp-calendar-day--today').click()
    
    const select = panel.locator('.dtp-input--select')
    await select.selectOption('weekly')
    
    await panel.locator('.dtp-btn--confirm').click()
    
    await page.waitForTimeout(500)
    
    const content = await page.locator('.block-content').first().innerText()
    expect(content).toMatch(/\{\{deadline:\d{4}-\d{2}-\d{2}\|weekly\}\}/)
  })

  test('DateTimePickerPanel can be closed with cancel', async ({ page }) => {
    const blockContent = page.locator('.block-content').first()
    await blockContent.click()
    await page.waitForTimeout(1000)
    
    await page.keyboard.type('/')
    await page.waitForTimeout(500)
    
    const scheduleItem = page.locator('.slash-command-menu .slash-command-item', { hasText: 'Schedule' })
    await scheduleItem.click()
    
    await page.waitForTimeout(500)
    
    const panel = page.locator('.dtp-panel')
    await expect(panel).toBeVisible()
    
    await panel.locator('.dtp-btn--cancel').click()
    
    await page.waitForTimeout(300)
    await expect(panel).toBeHidden()
  })

  test('DateTimePickerPanel can be closed with Escape', async ({ page }) => {
    const blockContent = page.locator('.block-content').first()
    await blockContent.click()
    await page.waitForTimeout(1000)
    
    await page.keyboard.type('/')
    await page.waitForTimeout(500)
    
    const scheduleItem = page.locator('.slash-command-menu .slash-command-item', { hasText: 'Schedule' })
    await scheduleItem.click()
    
    await page.waitForTimeout(500)
    
    const panel = page.locator('.dtp-panel')
    await expect(panel).toBeVisible()
    
    await page.keyboard.press('Escape')
    
    await page.waitForTimeout(300)
    await expect(panel).toBeHidden()
  })

  test('/time inserts current time', async ({ page }) => {
    const blockContent = page.locator('.block-content').first()
    await blockContent.click()
    await page.waitForTimeout(1000)
    
    await page.keyboard.type('/')
    await page.waitForTimeout(500)
    
    const timeItem = page.locator('.slash-command-menu .slash-command-item', { hasText: 'Time' })
    await timeItem.click()
    
    await page.waitForTimeout(500)
    
    const content = await page.locator('.block-content').first().innerText()
    expect(content).toMatch(/^\d{2}:\d{2}$/)
  })

  test('date-ref content renders with highlight', async ({ page }) => {
    const blockContent = page.locator('.block-content').first()
    await blockContent.click()
    await page.waitForTimeout(1000)
    
    await page.keyboard.type('/')
    await page.waitForTimeout(500)
    
    const scheduleItem = page.locator('.slash-command-menu .slash-command-item', { hasText: 'Schedule' })
    await scheduleItem.click()
    
    await page.waitForTimeout(500)
    
    const panel = page.locator('.dtp-panel')
    await expect(panel).toBeVisible()
    
    await panel.locator('.dtp-calendar-day--today').click()
    await panel.locator('.dtp-btn--confirm').click()
    
    await page.waitForTimeout(800)
    
    const activeBlock = page.locator('.block.active')
    await expect(activeBlock).toBeVisible()
    
    await page.waitForTimeout(500)
    
    const dateRefSpan = page.locator('.date-ref')
    await expect(dateRefSpan).toBeVisible()
    
    const kind = await dateRefSpan.getAttribute('data-kind')
    expect(kind).toBe('schedule')
  })

  test('T9: reading mode click date-ref opens panel and edits content', async ({ page }) => {
    const blockContent = page.locator('.block-content').first()
    await blockContent.click()
    await page.waitForTimeout(1000)
    
    await page.keyboard.type('/')
    await page.waitForTimeout(500)
    
    const scheduleItem = page.locator('.slash-command-menu .slash-command-item', { hasText: 'Schedule' })
    await scheduleItem.click()
    
    await page.waitForTimeout(500)
    
    const panel = page.locator('.dtp-panel')
    await expect(panel).toBeVisible()
    
    await panel.locator('.dtp-calendar-day--today').click()
    await panel.locator('.dtp-btn--confirm').click()
    
    await page.waitForTimeout(800)
    
    await page.locator('.ProseMirror').click()
    await page.waitForTimeout(300)
    
    await page.keyboard.press('Escape')
    await page.waitForTimeout(800)
    
    await expect(page.locator('.block.active')).toHaveCount(0)
    
    const blockText = page.locator('.block-text')
    await expect(blockText).toBeVisible()
    
    const dateRefSpan = blockText.locator('.date-ref')
    await expect(dateRefSpan).toBeVisible()
    
    const rawBefore = await dateRefSpan.getAttribute('data-raw')
    const isoBefore = await dateRefSpan.getAttribute('data-iso')
    expect(rawBefore).toBeTruthy()
    expect(isoBefore).toBeTruthy()
    
    const kind = await dateRefSpan.getAttribute('data-kind')
    expect(kind).toBe('schedule')
    
    await dateRefSpan.click()
    await page.waitForTimeout(500)
    
    await expect(panel).toBeVisible()
    
    const nextMonthBtn = panel.locator('.dtp-calendar-nav').nth(1)
    await nextMonthBtn.click()
    await panel.locator('.dtp-calendar-day').first().click()
    await panel.locator('.dtp-btn--confirm').click()
    
    await page.waitForTimeout(800)
    
    const updatedDateRefSpan = page.locator('.date-ref')
    await expect(updatedDateRefSpan).toBeVisible()
    
    const rawAfter = await updatedDateRefSpan.getAttribute('data-raw')
    const isoAfter = await updatedDateRefSpan.getAttribute('data-iso')
    
    expect(rawAfter).not.toBe(rawBefore)
    expect(isoAfter).not.toBe(isoBefore)
    
    const updatedKind = await updatedDateRefSpan.getAttribute('data-kind')
    expect(updatedKind).toBe('schedule')
  })

  test('T9: reading mode click deadline date-ref opens panel and edits content', async ({ page }) => {
    const blockContent = page.locator('.block-content').first()
    await blockContent.click()
    await page.waitForTimeout(1000)
    
    await page.keyboard.type('/')
    await page.waitForTimeout(500)
    
    const deadlineItem = page.locator('.slash-command-menu .slash-command-item', { hasText: 'Deadline' })
    await deadlineItem.click()
    
    await page.waitForTimeout(500)
    
    const panel = page.locator('.dtp-panel')
    await expect(panel).toBeVisible()
    
    await panel.locator('.dtp-calendar-day--today').click()
    await panel.locator('.dtp-btn--confirm').click()
    
    await page.waitForTimeout(800)
    
    await page.locator('.ProseMirror').click()
    await page.waitForTimeout(300)
    
    await page.keyboard.press('Escape')
    await page.waitForTimeout(800)
    
    await expect(page.locator('.block.active')).toHaveCount(0)
    
    const blockText = page.locator('.block-text')
    await expect(blockText).toBeVisible()
    
    const dateRefSpan = blockText.locator('.date-ref')
    await expect(dateRefSpan).toBeVisible()
    
    const rawBefore = await dateRefSpan.getAttribute('data-raw')
    const isoBefore = await dateRefSpan.getAttribute('data-iso')
    expect(rawBefore).toBeTruthy()
    expect(isoBefore).toBeTruthy()
    
    const kind = await dateRefSpan.getAttribute('data-kind')
    expect(kind).toBe('deadline')
    
    await dateRefSpan.click()
    await page.waitForTimeout(500)
    
    await expect(panel).toBeVisible()
    
    const nextMonthBtn = panel.locator('.dtp-calendar-nav').nth(1)
    await nextMonthBtn.click()
    await panel.locator('.dtp-calendar-day').first().click()
    await panel.locator('.dtp-btn--confirm').click()
    
    await page.waitForTimeout(800)
    
    const updatedDateRefSpan = page.locator('.date-ref')
    await expect(updatedDateRefSpan).toBeVisible()
    
    const rawAfter = await updatedDateRefSpan.getAttribute('data-raw')
    const isoAfter = await updatedDateRefSpan.getAttribute('data-iso')
    
    expect(rawAfter).not.toBe(rawBefore)
    expect(isoAfter).not.toBe(isoBefore)
    
    const updatedKind = await updatedDateRefSpan.getAttribute('data-kind')
    expect(updatedKind).toBe('deadline')
  })

  test('T9: reading mode click second date-ref in same block opens panel', async ({ page }) => {
    await page.evaluate(async () => {
      const { useBlockStore } = await import('./src/stores/blocks')
      const { usePageStore } = await import('./src/stores/pages')
      const blockStore = useBlockStore()
      const pageStore = usePageStore()
      const currentPageId = pageStore.currentPageId
      await blockStore.createBlock({
        pageId: currentPageId,
        content: '{{schedule:2026-07-16}} {{deadline:2026-07-20}}',
        pos: 1000,
      })
    })
    
    await page.waitForTimeout(1000)
    
    const dateRefSpans = page.locator('.block-text .date-ref')
    await expect(dateRefSpans).toHaveCount(2)
    
    const firstKind = await dateRefSpans.nth(0).getAttribute('data-kind')
    expect(firstKind).toBe('schedule')
    
    const secondKind = await dateRefSpans.nth(1).getAttribute('data-kind')
    expect(secondKind).toBe('deadline')
    
    await dateRefSpans.nth(1).click()
    await page.waitForTimeout(500)
    
    const panelCount = await page.locator('.dtp-panel').count()
    expect(panelCount).toBeGreaterThan(0)
  })
})