import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePageStore } from './pages'

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
    renamePage: vi.fn(),
    mergePage: vi.fn(),
    deletePage: vi.fn(),
    getPage: vi.fn(),
    getById: vi.fn()
  }
}))

vi.mock('./blocks', () => ({
  useBlockStore: vi.fn(() => ({
    loadPageBlocks: vi.fn()
  }))
}))

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('usePageStore', () => {
  describe('createPage', () => {
    test('创建普通页面', async () => {
      const store = usePageStore()
      const page = await store.createPage('Test Page')
      
      expect(page.title).toBe('Test Page')
      expect(page.type).toBe('normal')
      expect(store.pages.length).toBe(1)
      expect(store.pages[0].id).toBe(page.id)
    })

    test('创建日记页面', async () => {
      const store = usePageStore()
      const page = await store.createPage('2026-04-26', 'journal')
      
      expect(page.title).toBe('2026-04-26')
      expect(page.type).toBe('journal')
    })
  })

  describe('getPage', () => {
    test('通过 ID 获取页面', async () => {
      const store = usePageStore()
      const page = await store.createPage('Test Page')
      
      const found = store.getPage(page.id)
      expect(found?.id).toBe(page.id)
      expect(found?.title).toBe('Test Page')
    })

    test('获取不存在的页面返回 undefined', () => {
      const store = usePageStore()
      expect(store.getPage('non-existent')).toBeUndefined()
    })
  })

  describe('getPageByTitle', () => {
    test('通过标题获取页面', async () => {
      const store = usePageStore()
      await store.createPage('My Notes')
      
      const found = store.getPageByTitle('My Notes')
      expect(found?.title).toBe('My Notes')
    })

    test('标题匹配区分大小写', async () => {
      const store = usePageStore()
      await store.createPage('My Notes')
      
      expect(store.getPageByTitle('my notes')).toBeUndefined()
    })

    test('空标题返回 undefined', () => {
      const store = usePageStore()
      expect(store.getPageByTitle('')).toBeUndefined()
      expect(store.getPageByTitle('   ')).toBeUndefined()
    })

    test('获取不存在的标题返回 undefined', () => {
      const store = usePageStore()
      expect(store.getPageByTitle('Non-existent Page')).toBeUndefined()
    })
  })

  describe('renamePage', () => {
    test('重命名页面', async () => {
      const store = usePageStore()
      const page = await store.createPage('Old Title')
      const result = await store.renamePage(page.id, 'New Title')
      
      expect(result).toEqual({})
      expect(store.getPage(page.id)?.title).toBe('New Title')
    })

    test('重命名为空标题被拒绝', async () => {
      const store = usePageStore()
      const page = await store.createPage('Test')
      const result = await store.renamePage(page.id, '')
      
      expect(result).toEqual({})
      expect(store.getPage(page.id)?.title).toBe('Test')
    })

    test('重命名为相同标题无操作', async () => {
      const store = usePageStore()
      const page = await store.createPage('Same Title')
      const result = await store.renamePage(page.id, 'Same Title')
      
      expect(result).toEqual({})
    })

    test('重命名为已存在的标题返回重复信息', async () => {
      const store = usePageStore()
      const page1 = await store.createPage('Title')
      const page2 = await store.createPage('Another')
      
      const result = await store.renamePage(page2.id, 'Title')
      
      expect(result.duplicated).toBeDefined()
      expect(result.duplicated?.id).toBe(page1.id)
    })

    test('重命名不存在的页面无操作', async () => {
      const store = usePageStore()
      const result = await store.renamePage('non-existent', 'New Title')
      
      expect(result).toEqual({})
    })
  })

  describe('mergePage', () => {
    test('合并页面', async () => {
      const store = usePageStore()
      const source = await store.createPage('Source')
      const target = await store.createPage('Target')
      
      await store.mergePage(source.id, target.id)
      
      expect(store.pages.length).toBe(1)
      expect(store.pages[0].id).toBe(target.id)
    })

    test('合并后当前页面切换', async () => {
      const store = usePageStore()
      const source = await store.createPage('Source')
      const target = await store.createPage('Target')
      
      store.currentPageId = source.id
      await store.mergePage(source.id, target.id)
      
      expect(store.currentPageId).toBe(target.id)
    })

    test('合并非当前页面时当前页面不变', async () => {
      const store = usePageStore()
      const source = await store.createPage('Source')
      const target = await store.createPage('Target')
      const other = await store.createPage('Other')
      
      store.currentPageId = other.id
      await store.mergePage(source.id, target.id)
      
      expect(store.currentPageId).toBe(other.id)
    })
  })

  describe('deletePage', () => {
    test('删除页面', async () => {
      const store = usePageStore()
      const page = await store.createPage('To Delete')
      
      await store.deletePage(page.id)
      
      expect(store.pages.length).toBe(0)
    })

    test('删除当前页面时切换到第一个页面', async () => {
      const store = usePageStore()
      const page1 = await store.createPage('Page1')
      const page2 = await store.createPage('Page2')
      
      store.currentPageId = page1.id
      await store.deletePage(page1.id)
      
      expect(store.currentPageId).toBe(page2.id)
    })

    test('删除最后一个页面时 currentPageId 为空', async () => {
      const store = usePageStore()
      const page = await store.createPage('Only Page')
      
      store.currentPageId = page.id
      await store.deletePage(page.id)
      
      expect(store.currentPageId).toBe('')
    })

    test('删除非当前页面时当前页面不变', async () => {
      const store = usePageStore()
      const page1 = await store.createPage('Page1')
      const page2 = await store.createPage('Page2')
      
      store.currentPageId = page1.id
      await store.deletePage(page2.id)
      
      expect(store.currentPageId).toBe(page1.id)
    })

    test('删除不存在的页面无操作', async () => {
      const store = usePageStore()
      await store.createPage('Test')
      
      await store.deletePage('non-existent')
      
      expect(store.pages.length).toBe(1)
    })
  })

  describe('openPage', () => {
    test('打开页面设置 currentPageId', async () => {
      const store = usePageStore()
      const page = await store.createPage('Test')
      
      await store.openPage(page.id)
      
      expect(store.currentPageId).toBe(page.id)
    })
  })
})