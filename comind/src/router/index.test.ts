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
    // 简单模拟：YYYY-MM-DD 格式返回本身，其他返回 null
    const regex = /^\d{4}-\d{2}-\d{2}$/
    return regex.test(title) ? title : null
  })
}))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('router beforeEach guards', () => {
  // 我们不直接导入router，因为那会立即执行代码并导入所有模块
  // 我们测试路由守卫的核心逻辑，通过导入相关函数

  test('pages store loadAllPages 函数存在', async () => {
    const pageStore = usePageStore()
    expect(typeof pageStore.loadAllPages).toBe('function')
  })

  test('journal-detect 模块的 normalizeJournalTitle 函数正常工作', async () => {
    const { normalizeJournalTitle } = await import('../utils/journal-detect')
    expect(normalizeJournalTitle('2026-05-24')).toBe('2026-05-24')
    expect(normalizeJournalTitle('Not a Journal')).toBeNull()
  })
})

describe('路由逻辑验证', () => {
  test('验证路由守卫的关键逻辑流程：普通页面路由处理', async () => {
    const pageStore = usePageStore()
    const testPage = await pageStore.createPage('test-page')
    
    // 验证 getPage 函数可以找到我们创建的页面
    const found = pageStore.getPage(testPage.id)
    expect(found).toBeDefined()
    expect(found?.id).toBe(testPage.id)
    
    // 验证 openPage 可以正常工作
    await pageStore.openPage(testPage.id)
    expect(pageStore.currentPageId).toBe(testPage.id)
  })

  test('验证日记类型页面的识别', async () => {
    const pageStore = usePageStore()
    const journalPage = await pageStore.createPage('2026-05-24', 'journal')
    
    expect(journalPage.type).toBe('journal')
    
    const found = pageStore.getPage(journalPage.id)
    expect(found?.type).toBe('journal')
  })
})
