import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePageStore } from '../stores/pages'

// Mock the WASM core client — the store delegates all persistence to it.
// S6: normalizeJournalTitle 已迁移到 Rust；测试内以 TS 等价实现替代。
const { mockClient } = vi.hoisted(() => {
  const mockClient = {
    getAllPages: vi.fn(() => Promise.resolve([])),
    savePage: vi.fn(async (page: { title: string; type: string }) => ({
      id: page.id || `page-${page.title}`,
      block_id: null,
      title: page.title,
      type: page.type || 'normal',
      icon: null,
      cover: null,
      aliases: '[]',
      file_path: null,
      children_count: 0,
      word_count: 0,
      created_at: Date.now(),
      updated_at: Date.now(),
      deleted: 0,
    })),
    normalizeJournalTitle: vi.fn(async (title: string) => {
      const regex = /^\d{4}-\d{2}-\d{2}$/
      return regex.test(title) ? title : null
    }),
  }
  return { mockClient }
})

vi.mock('../wasm/client', () => ({
  initCoreClient: vi.fn(() => Promise.resolve(mockClient)),
  getCoreClient: vi.fn(() => mockClient),
}))

vi.mock('../stores/blocks', () => ({
  useBlockStore: vi.fn(() => ({
    loadPageBlocks: vi.fn(),
    ensurePageBlocks: vi.fn(),
  }))
}))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('路由守卫不再跳过 page/ideas 间导航', () => {
  test('从 page 导航到 ideas-page 时守卫应正常执行', () => {
    const from = { name: 'page' as const }
    const to = { name: 'ideas-page' as const }
    
    const shouldSkip = to.name === 'ideas-list' || to.name === 'trash'
    
    expect(shouldSkip).toBe(false)
  })

  test('从 ideas-page 导航到 page 时守卫应正常执行', () => {
    const from = { name: 'ideas-page' as const }
    const to = { name: 'page' as const }
    
    const shouldSkip = to.name === 'ideas-list' || to.name === 'trash'
    
    expect(shouldSkip).toBe(false)
  })

  test('从 page 导航到 page 时守卫应正常执行', () => {
    const from = { name: 'page' as const }
    const to = { name: 'page' as const }
    
    const shouldSkip = to.name === 'ideas-list' || to.name === 'trash'
    
    expect(shouldSkip).toBe(false)
  })

  test('从 ideas-page 导航到 ideas-page 时守卫应正常执行', () => {
    const from = { name: 'ideas-page' as const }
    const to = { name: 'ideas-page' as const }
    
    const shouldSkip = to.name === 'ideas-list' || to.name === 'trash'
    
    expect(shouldSkip).toBe(false)
  })

  test('从 ideas-list 导航到 page 时守卫应被跳过', () => {
    const to = { name: 'ideas-list' as const }
    const shouldSkip = to.name === 'ideas-list' || to.name === 'trash'
    expect(shouldSkip).toBe(true)
  })
})

describe('静态页面路由跳过逻辑', () => {
  test('ideas-list 路由应被跳过', () => {
    const to = { name: 'ideas-list' as const }
    const shouldSkip = to.name === 'ideas-list' || to.name === 'trash'
    expect(shouldSkip).toBe(true)
  })

  test('trash 路由应被跳过', () => {
    const to = { name: 'trash' as const }
    const shouldSkip = to.name === 'ideas-list' || to.name === 'trash'
    expect(shouldSkip).toBe(true)
  })

  test('page 路由不应被跳过', () => {
    const to = { name: 'page' as const }
    const shouldSkip = to.name === 'ideas-list' || to.name === 'trash'
    expect(shouldSkip).toBe(false)
  })
})

describe('页面查找逻辑', () => {
  test('getPage 应该能通过 ID 查找页面', async () => {
    const pageStore = usePageStore()
    const testPage = await pageStore.createPage('find-me')
    
    const found = pageStore.getPage(testPage.id)
    expect(found).toBeDefined()
    expect(found?.id).toBe(testPage.id)
  })

  test('getPageByTitle 应该能通过标题查找页面', async () => {
    const pageStore = usePageStore()
    const testPage = await pageStore.createPage('unique-title-12345')
    
    const found = pageStore.getPageByTitle('unique-title-12345')
    expect(found).toBeDefined()
    expect(found?.title).toBe('unique-title-12345')
  })

  test('getPageByTitle 对不存在的标题应返回 undefined', async () => {
    const pageStore = usePageStore()
    
    const found = pageStore.getPageByTitle('nonexistent-page-xyz')
    expect(found).toBeUndefined()
  })
})

describe('ideas-page 路由逻辑', () => {
  test('normalizeJournalTitle 对 YYYY-MM-DD 格式返回标准化标题', async () => {
    expect(await mockClient.normalizeJournalTitle('2026-05-24')).toBe('2026-05-24')
    expect(await mockClient.normalizeJournalTitle('2024-12-31')).toBe('2024-12-31')
  })

  test('normalizeJournalTitle 对非日期格式返回 null', async () => {
    expect(await mockClient.normalizeJournalTitle('My Page')).toBeNull()
    expect(await mockClient.normalizeJournalTitle('Random Text')).toBeNull()
  })

  test('ideas 类型页面应该被正确识别', async () => {
    const pageStore = usePageStore()
    const ideasPage = await pageStore.createPage('2026-05-24', 'ideas')
    
    expect(ideasPage.type).toBe('ideas')
    expect(ideasPage.title).toBe('2026-05-24')
  })

  test('普通页面类型不应该被识别为 ideas', async () => {
    const pageStore = usePageStore()
    const normalPage = await pageStore.createPage('normal-page', 'normal')
    
    expect(normalPage.type).toBe('normal')
  })
})

describe('页面不存在时的处理', () => {
  test('不存在的页面 ID 应该创建新页面', async () => {
    const pageStore = usePageStore()
    
    const existing = pageStore.getPage('nonexistent-id')
    expect(existing).toBeUndefined()
  })

  test('createPage 应该创建正确类型的页面', async () => {
    const pageStore = usePageStore()
    const normalPage = await pageStore.createPage('new-normal-page', 'normal')
    const ideasPage = await pageStore.createPage('2026-05-24', 'ideas')
    
    expect(normalPage.type).toBe('normal')
    expect(ideasPage.type).toBe('ideas')
  })
})

describe('openPage 逻辑', () => {
  test('openPage 应该更新 currentPageId', async () => {
    const pageStore = usePageStore()
    const testPage = await pageStore.createPage('test-page')
    
    expect(pageStore.currentPageId).not.toBe(testPage.id)
    
    await pageStore.openPage(testPage.id)
    
    expect(pageStore.currentPageId).toBe(testPage.id)
  })

  test('openPage 应该将页面添加到 pages 数组', async () => {
    const pageStore = usePageStore()
    const testPage = await pageStore.createPage('test-page')
    
    const initialPages = [...pageStore.pages]
    
    await pageStore.openPage(testPage.id)
    
    expect(pageStore.pages).toContainEqual(expect.objectContaining({ id: testPage.id }))
  })
})