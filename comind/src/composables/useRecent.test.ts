import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useRecent } from './useRecent'

vi.mock('../stores/pages', () => ({
  usePageStore: vi.fn(() => ({
    pages: []
  }))
}))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('useRecent', () => {
  test('初始状态下 isExpanded 为 false', () => {
    const { isExpanded } = useRecent()
    expect(isExpanded.value).toBe(false)
  })

  test('toggleExpand 切换展开状态', () => {
    const { isExpanded, toggleExpand } = useRecent()
    expect(isExpanded.value).toBe(false)
    toggleExpand()
    expect(isExpanded.value).toBe(true)
    toggleExpand()
    expect(isExpanded.value).toBe(false)
  })

  test('收起时显示最近 3 个页面', async () => {
    const { usePageStore } = await import('../stores/pages')
    const pages = [
      { id: 'page-1', title: 'Page 1', updatedAt: new Date(Date.now() - 10000).toISOString() },
      { id: 'page-2', title: 'Page 2', updatedAt: new Date(Date.now() - 20000).toISOString() },
      { id: 'page-3', title: 'Page 3', updatedAt: new Date(Date.now() - 30000).toISOString() },
      { id: 'page-4', title: 'Page 4', updatedAt: new Date(Date.now() - 40000).toISOString() }
    ]

    vi.mocked(usePageStore).mockReturnValue({
      pages
    } as any)

    const { recentPages } = useRecent()
    expect(recentPages.value.length).toBe(3)
    expect(recentPages.value[0].id).toBe('page-1')
    expect(recentPages.value[1].id).toBe('page-2')
    expect(recentPages.value[2].id).toBe('page-3')
  })

  test('展开时显示最近 10 个页面', async () => {
    const { usePageStore } = await import('../stores/pages')
    const pages = Array.from({ length: 15 }, (_, i) => ({
      id: `page-${i + 1}`,
      title: `Page ${i + 1}`,
      updatedAt: new Date(Date.now() - (i + 1) * 10000).toISOString()
    }))

    vi.mocked(usePageStore).mockReturnValue({
      pages
    } as any)

    const { recentPages, toggleExpand } = useRecent()
    toggleExpand()
    expect(recentPages.value.length).toBe(10)
    expect(recentPages.value[0].id).toBe('page-1')
    expect(recentPages.value[9].id).toBe('page-10')
  })

  test('recentPages 按 updatedAt 降序排列', async () => {
    const { usePageStore } = await import('../stores/pages')
    const pages = [
      { id: 'oldest', title: 'Oldest', updatedAt: new Date(Date.now() - 100000).toISOString() },
      { id: 'newest', title: 'Newest', updatedAt: new Date().toISOString() },
      { id: 'middle', title: 'Middle', updatedAt: new Date(Date.now() - 50000).toISOString() }
    ]

    vi.mocked(usePageStore).mockReturnValue({
      pages
    } as any)

    const { recentPages } = useRecent()
    expect(recentPages.value[0].id).toBe('newest')
    expect(recentPages.value[1].id).toBe('middle')
    expect(recentPages.value[2].id).toBe('oldest')
  })

  test('空页面列表返回空数组', async () => {
    const { usePageStore } = await import('../stores/pages')
    vi.mocked(usePageStore).mockReturnValue({
      pages: []
    } as any)

    const { recentPages } = useRecent()
    expect(recentPages.value).toEqual([])
  })

  test('少于 3 个页面时显示所有页面', async () => {
    const { usePageStore } = await import('../stores/pages')
    const pages = [
      { id: 'page-1', title: 'Page 1', updatedAt: new Date().toISOString() },
      { id: 'page-2', title: 'Page 2', updatedAt: new Date(Date.now() - 10000).toISOString() }
    ]

    vi.mocked(usePageStore).mockReturnValue({
      pages
    } as any)

    const { recentPages } = useRecent()
    expect(recentPages.value.length).toBe(2)
  })
})
