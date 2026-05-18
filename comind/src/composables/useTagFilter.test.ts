import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTagFilter, invalidateTagCache } from './useTagFilter'

vi.mock('../storage/indexedDB', () => ({
  storage: {
    getAllBlocks: vi.fn()
  }
}))

vi.mock('../stores/pages', () => ({
  usePageStore: vi.fn(() => ({
    getPage: vi.fn((pageId: string) => ({
      id: pageId,
      title: `Page ${pageId}`,
      type: 'normal',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }))
  }))
}))

vi.mock('../stores/editor', () => ({
  useEditorStore: vi.fn(() => ({
    activateBlock: vi.fn()
  }))
}))

beforeEach(() => {
  setActivePinia(createPinia())
  invalidateTagCache()
})

describe('useTagFilter', () => {
  const mockBlocks = [
    { id: 'b1', content: 'Hello #tag1 world', pageId: 'p1' },
    { id: 'b2', content: 'Another #tag1 example', pageId: 'p1' },
    { id: 'b3', content: 'Different #tag2 here', pageId: 'p2' },
    { id: 'b4', content: 'Nested tag #tag1/subtag', pageId: 'p1' },
    { id: 'b5', content: 'No tags here', pageId: 'p2' },
    { id: 'b6', content: 'Multiple #tag1 and #tag2', pageId: 'p3' },
    { id: 'b7', content: 'Email test@example.com', pageId: 'p3' }
  ]

  describe('filterByTag', () => {
    test('过滤匹配的标签', async () => {
      const storage = await import('../storage/indexedDB')
      storage.storage.getAllBlocks = vi.fn().mockResolvedValue(mockBlocks)
      
      const { openFilter, groupedResults } = useTagFilter()
      await openFilter('tag1')
      
      const results = groupedResults.value
      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results.every(item => item.block.content.includes('#tag1'))).toBe(true)
    })

    test('区分大小写不敏感', async () => {
      const storage = await import('../storage/indexedDB')
      storage.storage.getAllBlocks = vi.fn().mockResolvedValue([
        { id: 'b1', content: 'Hello #TAG1 world', pageId: 'p1' },
        { id: 'b2', content: 'Another #tag1 example', pageId: 'p1' }
      ])
      
      const { openFilter, groupedResults } = useTagFilter()
      await openFilter('TAG1')
      
      const results = groupedResults.value
      expect(results.length).toBe(2)
    })

    test('正确处理嵌套标签', async () => {
      const storage = await import('../storage/indexedDB')
      storage.storage.getAllBlocks = vi.fn().mockResolvedValue([
        { id: 'b1', content: 'Parent #tag', pageId: 'p1' },
        { id: 'b2', content: 'Child #tag/subtag', pageId: 'p1' },
        { id: 'b3', content: 'Deep #tag/subtag/nested', pageId: 'p2' },
        { id: 'b4', content: 'Different #other/subtag', pageId: 'p2' }
      ])
      
      const { openFilter, groupedResults } = useTagFilter()
      await openFilter('tag')
      
      const results = groupedResults.value
      expect(results.length).toBe(3)
    })

    test('不匹配 email 地址中的 @', async () => {
      const storage = await import('../storage/indexedDB')
      storage.storage.getAllBlocks = vi.fn().mockResolvedValue([
        { id: 'b1', content: 'Email test@example.com', pageId: 'p1' },
        { id: 'b2', content: 'Tag #email here', pageId: 'p1' }
      ])
      
      const { openFilter, groupedResults } = useTagFilter()
      await openFilter('email')
      
      const results = groupedResults.value
      expect(results.length).toBe(1)
      expect(results[0].block.id).toBe('b2')
    })

    test('过滤不存在的标签返回空数组', async () => {
      const storage = await import('../storage/indexedDB')
      storage.storage.getAllBlocks = vi.fn().mockResolvedValue(mockBlocks)
      
      const { openFilter, groupedResults } = useTagFilter()
      await openFilter('non-existent-tag')
      
      expect(groupedResults.value).toEqual([])
    })
  })

  describe('缓存机制', () => {
    test('首次打开过滤时预加载数据', async () => {
      const storage = await import('../storage/indexedDB')
      const getAllBlocksSpy = vi.fn().mockResolvedValue(mockBlocks)
      storage.storage.getAllBlocks = getAllBlocksSpy
      
      const { openFilter } = useTagFilter()
      await openFilter('tag1')
      
      expect(getAllBlocksSpy).toHaveBeenCalledTimes(1)
    })

    test('多次打开不同标签使用缓存', async () => {
      const storage = await import('../storage/indexedDB')
      const getAllBlocksSpy = vi.fn().mockResolvedValue(mockBlocks)
      storage.storage.getAllBlocks = getAllBlocksSpy
      
      const { openFilter, closeFilter } = useTagFilter()
      await openFilter('tag1')
      closeFilter()
      
      invalidateTagCache()
      
      await openFilter('tag2')
      
      expect(getAllBlocksSpy).toHaveBeenCalledTimes(2)
    })

    test('invalidateTagCache 清除缓存', async () => {
      const storage = await import('../storage/indexedDB')
      const getAllBlocksSpy = vi.fn().mockResolvedValue(mockBlocks)
      storage.storage.getAllBlocks = getAllBlocksSpy
      
      const { openFilter, closeFilter } = useTagFilter()
      await openFilter('tag1')
      closeFilter()
      
      invalidateTagCache()
      
      await openFilter('tag2')
      
      expect(getAllBlocksSpy).toHaveBeenCalledTimes(2)
    })
  })

  describe('byPage 分组', () => {
    test('按页面分组结果', async () => {
      const storage = await import('../storage/indexedDB')
      storage.storage.getAllBlocks = vi.fn().mockResolvedValue(mockBlocks)
      
      const { openFilter, byPage } = useTagFilter()
      await openFilter('tag1')
      
      const groups = byPage.value
      expect(groups.size).toBeGreaterThan(0)
    })
  })

  describe('状态管理', () => {
    test('isOpen 正确反映过滤状态', async () => {
      const storage = await import('../storage/indexedDB')
      storage.storage.getAllBlocks = vi.fn().mockResolvedValue([])
      
      const { openFilter, closeFilter, isOpen } = useTagFilter()
      
      expect(isOpen.value).toBe(false)
      
      await openFilter('tag')
      expect(isOpen.value).toBe(true)
      
      closeFilter()
      expect(isOpen.value).toBe(false)
    })

    test('activeTag 正确设置', async () => {
      const storage = await import('../storage/indexedDB')
      storage.storage.getAllBlocks = vi.fn().mockResolvedValue([])
      
      const { openFilter, closeFilter, activeTag } = useTagFilter()
      
      expect(activeTag.value).toBe(null)
      
      await openFilter('my-tag')
      expect(activeTag.value).toBe('my-tag')
      
      closeFilter()
      expect(activeTag.value).toBe(null)
    })
  })
})