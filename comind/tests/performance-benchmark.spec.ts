import { test, expect } from '@playwright/test'

test.describe('Phase 3 Performance Benchmark', () => {
  
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('[data-testid="page-container"]', { timeout: 10000 })
  })

  test('Block 创建性能：1000 个 Block', async ({ page }) => {
    const startTime = Date.now()
    
    for (let i = 0; i < 1000; i++) {
      await page.keyboard.type(`Block ${i}`)
      await page.keyboard.press('Enter')
    }
    
    const endTime = Date.now()
    const duration = endTime - startTime
    
    console.log(`Created 1000 blocks in ${duration}ms`)
    
    expect(duration).toBeLessThan(10000)
  })

  test('Block 查询性能：1000 个 Block 按 pageId 查询', async ({ page }) => {
    const testPageId = 'benchmark-page'
    
    const startTime = Date.now()
    
    const result = await page.evaluate(async () => {
      const { useBlockStore } = await import('../src/stores/blocks')
      const store = useBlockStore()
      const blocks = store.getBlocksByPage(testPageId)
      return blocks.length
    })
    
    const endTime = Date.now()
    const duration = endTime - startTime
    
    console.log(`Query blocks in ${duration}ms`)
    
    expect(duration).toBeLessThan(100)
  })

  test('搜索性能：全文搜索', async ({ page }) => {
    const startTime = Date.now()
    
    await page.keyboard.press('Control+k')
    await page.waitForSelector('[data-testid="search-panel"]', { timeout: 5000 })
    await page.keyboard.type('Block')
    
    await page.waitForTimeout(500)
    
    const endTime = Date.now()
    const duration = endTime - startTime
    
    console.log(`Search in ${duration}ms`)
    
    expect(duration).toBeLessThan(200)
  })

  test('页面切换性能：加载页面', async ({ page }) => {
    const testPageId = 'benchmark-page-100'
    
    const startTime = Date.now()
    
    await page.evaluate(async (pageId) => {
      const { usePageStore } = await import('../src/stores/pages')
      const { useBlockStore } = await import('../src/stores/blocks')
      const pageStore = usePageStore()
      const blockStore = useBlockStore()
      await pageStore.openPage(pageId)
      await blockStore.loadPageBlocks(pageId)
    }, testPageId)
    
    const endTime = Date.now()
    const duration = endTime - startTime
    
    console.log(`Load page in ${duration}ms`)
    
    expect(duration).toBeLessThan(500)
  })
})