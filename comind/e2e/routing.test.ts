/**
 * 路由系统 E2E 测试
 * 测试文档：docs/routing-test-plan.md
 * 设计文档：docs/routing-design.md
 */

import { test, expect, Page } from '@playwright/test'

const BASE_URL = 'http://localhost:5173'

test.describe('路由系统测试', () => {
  test.beforeEach(async ({ page }) => {
    // 确保开发服务器运行
    await page.goto(BASE_URL)
    // 等待应用加载完成
    await page.waitForSelector('.app-layout', { timeout: 10000 })
  })

  test('TC-01: 首页重定向到 /journal', async ({ page }) => {
    await page.goto(BASE_URL + '/')
    await page.waitForURL(/\/journal/, { timeout: 5000 })
    
    const url = page.url()
    expect(url).toContain('/journal')
    
    // 验证日记列表视图显示
    const journalList = page.locator('.journal-list-view')
    await expect(journalList).toBeVisible({ timeout: 5000 })
  })

  test('TC-02: 日记列表路由 /journal', async ({ page }) => {
    await page.goto(BASE_URL + '/journal')
    
    // 验证 URL 正确
    expect(page.url()).toContain('/journal')
    
    // 验证 JournalList 组件渲染
    const journalList = page.locator('.journal-list-view')
    await expect(journalList).toBeVisible({ timeout: 5000 })
    
    // 验证日记条目列表存在
    const entries = page.locator('.journal-entries')
    await expect(entries).toBeVisible()
  })

  test('TC-03: 日记页面路由 /journal/:date', async ({ page }) => {
    // 先访问日记列表，获取一个日记日期
    await page.goto(BASE_URL + '/journal')
    await page.waitForSelector('.journal-list-view', { timeout: 5000 })
    
    // 等待日记列表加载
    await page.waitForTimeout(1000)
    
    // 尝试获取第一个日记条目
    const firstJournal = page.locator('.journal-list-item').first()
    const journalCount = await firstJournal.count()
    
    if (journalCount > 0) {
      // 点击第一个日记的标题区域
      const firstJournalHeader = firstJournal.locator('.entry-header')
      await firstJournalHeader.click()
      await page.waitForURL(/\/journal\/\d{4}-\d{2}-\d{2}/, { timeout: 5000 })
      
      // 验证 URL 格式
      const url = page.url()
      expect(url).toMatch(/\/journal\/\d{4}-\d{2}-\d{2}/)
      
      // 验证 PageView 组件渲染
      const pageView = page.locator('.page-scroll-wrapper')
      await expect(pageView).toBeVisible({ timeout: 5000 })
    } else {
      // 如果没有日记，测试手动创建今天的日记
      const today = new Date().toISOString().split('T')[0]
      await page.goto(BASE_URL + `/journal/${today}`)
      await page.waitForURL(/\/journal\/\d{4}-\d{2}-\d{2}/, { timeout: 5000 })
      
      // 验证 PageView 组件渲染
      const pageView = page.locator('.page-scroll-wrapper')
      await expect(pageView).toBeVisible({ timeout: 5000 })
    }
  })

  test('TC-04: 普通页面路由 /page/:pageId', async ({ page }) => {
    // 先访问日记列表，确保数据加载
    await page.goto(BASE_URL + '/journal')
    await page.waitForSelector('.journal-list-view', { timeout: 5000 })
    await page.waitForTimeout(500)
    
    // 尝试从最近列表获取页面
    const recentItem = page.locator('.recent-section .page-item').first()
    const recentCount = await recentItem.count()
    
    if (recentCount > 0) {
      // 点击最近页面
      await recentItem.click()
      await page.waitForTimeout(1000)
      
      // 验证 URL 是 /page/:id 或 /journal/:date
      const url = page.url()
      expect(url).toMatch(/\/(page|journal)\/.+/)
      
      // 如果是普通页面，验证 PageView 渲染
      const pageView = page.locator('.page-scroll-wrapper')
      await expect(pageView).toBeVisible({ timeout: 5000 })
    } else {
      // 没有最近页面，跳过此测试
      test.skip()
    }
  })

  test('TC-05: 刷新恢复', async ({ page }) => {
    // 访问日记列表
    await page.goto(BASE_URL + '/journal')
    await page.waitForSelector('.journal-list-view', { timeout: 5000 })
    
    // 点击第一个日记
    const firstJournal = page.locator('.journal-list-item').first()
    if (await firstJournal.count() > 0) {
      const firstJournalHeader = firstJournal.locator('.entry-header')
      await firstJournalHeader.click()
      await page.waitForURL(/\/journal\/\d{4}-\d{2}-\d{2}/, { timeout: 5000 })
      
      const urlBeforeRefresh = page.url()
      
      // 刷新页面
      await page.reload()
      
      // 等待页面加载
      await page.waitForSelector('.page-scroll-wrapper', { timeout: 10000 })
      
      // 验证 URL 保持不变
      const urlAfterRefresh = page.url()
      expect(urlAfterRefresh).toBe(urlBeforeRefresh)
      
      // 验证 PageView 渲染
      const pageView = page.locator('.page-scroll-wrapper')
      await expect(pageView).toBeVisible()
    } else {
      test.skip()
    }
  })

  test('TC-06: 浏览器历史 (Back/Forward)', async ({ page }) => {
    // 访问日记列表
    await page.goto(BASE_URL + '/journal')
    await page.waitForSelector('.journal-list-view', { timeout: 5000 })
    
    const firstJournal = page.locator('.journal-list-item').first()
    if (await firstJournal.count() > 0) {
      // 点击第一个日记的标题区域
      const firstJournalHeader = firstJournal.locator('.entry-header')
      await firstJournalHeader.click()
      await page.waitForURL(/\/journal\/\d{4}-\d{2}-\d{2}/, { timeout: 5000 })
      
      const journalUrl = page.url()
      expect(journalUrl).toMatch(/\/journal\/\d{4}-\d{2}-\d{2}/)
      
      // 点击 Back
      await page.goBack()
      await page.waitForURL(/\/journal$/, { timeout: 5000 })
      
      // 验证回到日记列表
      expect(page.url()).toContain('/journal')
      const journalList = page.locator('.journal-list-view')
      await expect(journalList).toBeVisible({ timeout: 5000 })
      
      // 点击 Forward
      await page.goForward()
      await page.waitForURL(/\/journal\/\d{4}-\d{2}-\d{2}/, { timeout: 5000 })
      
      // 验证回到日记页面
      expect(page.url()).toMatch(/\/journal\/\d{4}-\d{2}-\d{2}/)
    } else {
      test.skip()
    }
  })

  test('TC-07: 404 优雅处理 - 不存在的页面 ID', async ({ page }) => {
    // 监听控制台错误
    const errors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text())
      }
    })
    
    // 访问不存在的页面
    await page.goto(BASE_URL + '/page/non-existent-page-id-12345')
    
    // 等待页面加载（应该重定向到 /journal 或显示空页面）
    await page.waitForTimeout(2000)
    
    // 验证页面没有崩溃
    const appLayout = page.locator('.app-layout')
    await expect(appLayout).toBeVisible({ timeout: 5000 })
    
    // 验证没有严重的 JavaScript 错误
    const criticalErrors = errors.filter(e => 
      e.includes('TypeError') || 
      e.includes('ReferenceError') ||
      e.includes('Cannot read properties')
    )
    expect(criticalErrors.length).toBe(0)
  })

  test('TC-08: Sidebar 导航 - 日记入口', async ({ page }) => {
    await page.goto(BASE_URL + '/journal')
    await page.waitForSelector('.journal-list-view', { timeout: 5000 })
    
    // 点击第一个日记进入页面
    const firstJournal = page.locator('.journal-list-item').first()
    if (await firstJournal.count() > 0) {
      const firstJournalHeader = firstJournal.locator('.entry-header')
      await firstJournalHeader.click()
      await page.waitForURL(/\/journal\/\d{4}-\d{2}-\d{2}/, { timeout: 5000 })
    }
    
    // 点击 Sidebar 的日记入口
    const journalHero = page.locator('.journal-hero')
    await expect(journalHero).toBeVisible()
    await journalHero.click()
    
    // 验证导航到日记列表
    await page.waitForURL(/\/journal$/, { timeout: 5000 })
    expect(page.url()).toContain('/journal')
    
    const journalList = page.locator('.journal-list-view')
    await expect(journalList).toBeVisible({ timeout: 5000 })
  })

  test('TC-09: Sidebar 导航 - 最近页面', async ({ page }) => {
    await page.goto(BASE_URL + '/journal')
    await page.waitForSelector('.journal-list-view', { timeout: 5000 })
    await page.waitForTimeout(1000)
    
    // 点击最近页面
    const recentItem = page.locator('.recent-section .page-item').first()
    if (await recentItem.count() > 0) {
      await recentItem.click()
      await page.waitForTimeout(1000)
      
      // 验证 URL 变化
      const url = page.url()
      expect(url).toMatch(/\/(page|journal)\/.+/)
    } else {
      test.skip()
    }
  })

  test('TC-10: 无 JavaScript 错误', async ({ page }) => {
    const errors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text())
      }
    })
    
    // 访问多个路由
    await page.goto(BASE_URL + '/')
    await page.waitForURL(/\/journal/, { timeout: 5000 })
    
    const firstJournal = page.locator('.journal-list-item').first()
    if (await firstJournal.count() > 0) {
      await firstJournal.click()
      await page.waitForTimeout(1000)
    }
    
    await page.goBack()
    await page.waitForTimeout(500)
    
    // 验证没有严重的 JavaScript 错误
    const criticalErrors = errors.filter(e => 
      e.includes('TypeError') || 
      e.includes('ReferenceError') ||
      e.includes('Cannot read properties') ||
      e.includes('Uncaught')
    )
    expect(criticalErrors.length).toBe(0)
  })
})
