import { test, expect } from '@playwright/test'

test.describe('Web WASM Performance Benchmark', () => {
  test('should load WASM module and initialize Core client', async ({ page }) => {
    await page.goto('http://localhost:5178')
    
    await page.waitForTimeout(5000)
    
    const result = await page.evaluate(async () => {
      try {
        const clientFn = window.__get_core_client
        if (typeof clientFn !== 'function') {
          return { ready: false, error: '__get_core_client is not a function' }
        }
        const client = clientFn()
        if (!client) {
          return { ready: false, error: 'client is null' }
        }
        return { ready: true, error: null }
      } catch (e: any) {
        return { ready: false, error: e.message }
      }
    })
    
    console.log('Client init result:', JSON.stringify(result))
    expect(result.ready).toBe(true)
  })

  test('should create 100 blocks within acceptable time', async ({ page }) => {
    await page.goto('http://localhost:5178')
    
    page.on('console', (msg) => {
      console.log('Browser console:', msg.text())
    })

    await page.waitForFunction(() => {
      const clientFn = window.__get_core_client
      if (typeof clientFn !== 'function') return false
      const client = clientFn()
      return client !== null
    }, { timeout: 10000 })

    const result = await page.evaluate(async () => {
      console.log('=== Test start ===')
      console.log('__get_core_client type:', typeof window.__get_core_client)
      const clientFn = window.__get_core_client
      if (typeof clientFn !== 'function') {
        console.log('ERROR: __get_core_client is not a function')
        return { time: -1, error: '__get_core_client is not a function' }
      }
      const client = clientFn()
      console.log('client:', client)
      console.log('client type:', typeof client)
      if (!client) {
        console.log('ERROR: client is null/undefined')
        return { time: -1, error: 'client is null/undefined' }
      }
      console.log('saveBlockTree type:', typeof client.saveBlockTree)
      if (typeof client.saveBlockTree !== 'function') {
        console.log('ERROR: saveBlockTree is not a function')
        return { time: -1, error: 'saveBlockTree is not a function' }
      }

      const start = performance.now()
      for (let i = 0; i < 100; i++) {
        const block = {
          id: `test-block-${i}-${Date.now()}`,
          page_id: 'test-page',
          parent_id: null,
          pos: i * 1000,
          content: `Test block ${i} content`,
          format: '{}',
          type: 'bullet',
          created_at: Date.now(),
          updated_at: Date.now()
        }
        try {
          const res = await client.saveBlockTree([block])
          console.log('Block created:', i, res)
        } catch (e: any) {
          console.log('ERROR creating block:', i, e.message)
          throw e
        }
      }
      const end = performance.now()
      console.log('=== Test end ===')
      return { time: end - start, error: null }
    })
    
    console.log('Create blocks result:', JSON.stringify(result))
    expect(result.error).toBeNull()
    const createTime = result.time

    expect(createTime).toBeGreaterThan(0)
    expect(createTime).toBeLessThan(10000)
  })

  test('should query 100 blocks within acceptable time', async ({ page }) => {
    await page.goto('http://localhost:5178')
    await page.waitForTimeout(5000)

    const queryTime = await page.evaluate(async () => {
      const client = window.__get_core_client()
      if (!client) return -1

      const start = performance.now()
      await client.getBlocksByPage('test-page')
      const end = performance.now()
      return end - start
    })

    expect(queryTime).toBeGreaterThan(0)
    expect(queryTime).toBeLessThan(2000)
  })

  test('should search within acceptable time', async ({ page }) => {
    await page.goto('http://localhost:5178')
    await page.waitForTimeout(5000)

    const searchTime = await page.evaluate(async () => {
      const client = window.__get_core_client()
      if (!client) return -1

      const start = performance.now()
      await client.search('test')
      const end = performance.now()
      return end - start
    })

    expect(searchTime).toBeGreaterThan(0)
    expect(searchTime).toBeLessThan(1000)
  })

  test('should create and delete a page', async ({ page }) => {
    await page.goto('http://localhost:5178')
    await page.waitForTimeout(5000)

    const result = await page.evaluate(async () => {
      const client = window.__get_core_client()
      if (!client) return { success: false, error: 'no client' }

      try {
        const pageData = {
          id: 'perf-test-page-' + Date.now(),
          block_id: null,
          title: 'Performance Test Page',
          type: 'normal',
          icon: null,
          cover: null,
          aliases: '[]',
          file_path: null,
          children_count: 0,
          word_count: 0,
          deleted: 0,
          created_at: Date.now(),
          updated_at: Date.now()
        }

        const savedPage = await client.savePage(pageData)
        console.log('Saved page:', savedPage)
        
        const pages = await client.getAllPages()
        console.log('All pages:', pages)
        
        const actualPageId = savedPage?.id || pageData.id
        const found = pages.some(p => p.id === actualPageId)

        await client.deletePageCascade(actualPageId)
        const pagesAfter = await client.getAllPages()
        const deleted = !pagesAfter.some(p => p.id === actualPageId)

        return { success: found && deleted, found, deleted, pageCount: pages.length, savedPageId: actualPageId }
      } catch (e: any) {
        console.error('Error:', e.message)
        return { success: false, error: e.message, stack: e.stack }
      }
    })

    console.log('Page test result:', JSON.stringify(result))
    expect(result.success).toBe(true)
  })
})
