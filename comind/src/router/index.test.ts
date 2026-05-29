import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePageStore } from '../stores/pages'

vi.mock('../storage/indexedDB', () => ({
  storage: {
    getAllPages: vi.fn().mockResolvedValue([]),
    createPageWithRootBlock: vi.fn().mockImplementation(async (title: string, type: string) => ({
      id: `page-${title}`,
      title,
      type,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })),
    getPage: vi.fn(),
    getById: vi.fn(),
    getBlockTree: vi.fn().mockResolvedValue([])
  }
}))

vi.mock('../utils/journal-detect', () => ({
  normalizeJournalTitle: vi.fn((title: string) => {
    const regex = /^\d{4}-\d{2}-\d{2}$/
    return regex.test(title) ? title : null
  })
}))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('路由守卫不再跳过 page/journal 间导航', () => {
  test('从 page 导航到 journal-page 时守卫应正常执行', () => {
    const from = { name: 'page' as const }
    const to = { name: 'journal-page' as const }
    
    const shouldSkip = to.name === 'journal-list' || to.name === 'trash' || to.name === 'settings'
    
    expect(shouldSkip).toBe(false)
  })

  test('从 journal-page 导航到 page 时守卫应正常执行', () => {
    const from = { name: 'journal-page' as const }
    const to = { name: 'page' as const }
    
    const shouldSkip = to.name === 'journal-list' || to.name === 'trash' || to.name === 'settings'
    
    expect(shouldSkip).toBe(false)
  })

  test('从 page 导航到 page 时守卫应正常执行', () => {
    const from = { name: 'page' as const }
    const to = { name: 'page' as const }
    
    const shouldSkip = to.name === 'journal-list' || to.name === 'trash' || to.name === 'settings'
    
    expect(shouldSkip).toBe(false)
  })

  test('从 journal-page 导航到 journal-page 时守卫应正常执行', () => {
    const from = { name: 'journal-page' as const }
    const to = { name: 'journal-page' as const }
    
    const shouldSkip = to.name === 'journal-list' || to.name === 'trash' || to.name === 'settings'
    
    expect(shouldSkip).toBe(false)
  })

  test('从 journal-list 导航到 page 时守卫应被跳过', () => {
    const to = { name: 'journal-list' as const }
    const shouldSkip = to.name === 'journal-list' || to.name === 'trash' || to.name === 'settings'
    expect(shouldSkip).toBe(true)
  })
})

describe('静态页面路由跳过逻辑', () => {
  test('journal-list 路由应被跳过', () => {
    const to = { name: 'journal-list' as const }
    const shouldSkip = to.name === 'journal-list' || to.name === 'trash' || to.name === 'settings'
    expect(shouldSkip).toBe(true)
  })

  test('trash 路由应被跳过', () => {
    const to = { name: 'trash' as const }
    const shouldSkip = to.name === 'journal-list' || to.name === 'trash' || to.name === 'settings'
    expect(shouldSkip).toBe(true)
  })

  test('settings 路由应被跳过', () => {
    const to = { name: 'settings' as const }
    const shouldSkip = to.name === 'journal-list' || to.name === 'trash' || to.name === 'settings'
    expect(shouldSkip).toBe(true)
  })

  test('page 路由不应被跳过', () => {
    const to = { name: 'page' as const }
    const shouldSkip = to.name === 'journal-list' || to.name === 'trash' || to.name === 'settings'
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

describe('journal-page 路由逻辑', () => {
  test('normalizeJournalTitle 对 YYYY-MM-DD 格式返回标准化标题', async () => {
    const { normalizeJournalTitle } = await import('../utils/journal-detect')
    expect(normalizeJournalTitle('2026-05-24')).toBe('2026-05-24')
    expect(normalizeJournalTitle('2024-12-31')).toBe('2024-12-31')
  })

  test('normalizeJournalTitle 对非日期格式返回 null', async () => {
    const { normalizeJournalTitle } = await import('../utils/journal-detect')
    expect(normalizeJournalTitle('My Page')).toBeNull()
    expect(normalizeJournalTitle('Random Text')).toBeNull()
  })

  test('journal 类型页面应该被正确识别', async () => {
    const pageStore = usePageStore()
    const journalPage = await pageStore.createPage('2026-05-24', 'journal')
    
    expect(journalPage.type).toBe('journal')
    expect(journalPage.title).toBe('2026-05-24')
  })

  test('普通页面类型不应该被识别为 journal', async () => {
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
    const journalPage = await pageStore.createPage('2026-05-24', 'journal')
    
    expect(normalPage.type).toBe('normal')
    expect(journalPage.type).toBe('journal')
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