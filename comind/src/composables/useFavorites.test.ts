import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFavorites } from './useFavorites'
import { usePageStore } from '../stores/pages'

// 模拟 localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    clear: vi.fn(() => {
      store = {}
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    })
  }
})()

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
})

vi.mock('../stores/pages', () => ({
  usePageStore: vi.fn(() => ({
    pages: [],
    getPage: vi.fn()
  }))
}))

beforeEach(() => {
  setActivePinia(createPinia())
  localStorageMock.clear()
  localStorageMock.getItem.mockClear()
  localStorageMock.setItem.mockClear()
})

describe('useFavorites', () => {
  test('初始收藏列表为空', () => {
    const { favoritePages } = useFavorites()
    expect(favoritePages.value).toEqual([])
  })

  test('isFavorite 检查收藏状态', () => {
    const { isFavorite, addFavorite } = useFavorites()
    expect(isFavorite('page-1')).toBe(false)
    addFavorite('page-1')
    expect(isFavorite('page-1')).toBe(true)
  })

  test('addFavorite 添加页面到收藏', () => {
    const { addFavorite, isFavorite } = useFavorites()
    addFavorite('page-1')
    expect(isFavorite('page-1')).toBe(true)
  })

  test('addFavorite 重复添加同一页面无操作', () => {
    const { addFavorite, isFavorite } = useFavorites()
    addFavorite('page-1')
    addFavorite('page-1')
    expect(isFavorite('page-1')).toBe(true)
  })

  test('removeFavorite 从收藏移除页面', () => {
    const { addFavorite, removeFavorite, isFavorite } = useFavorites()
    addFavorite('page-1')
    expect(isFavorite('page-1')).toBe(true)
    removeFavorite('page-1')
    expect(isFavorite('page-1')).toBe(false)
  })

  test('removeFavorite 移除不存在的页面无操作', () => {
    const { removeFavorite, isFavorite } = useFavorites()
    expect(() => removeFavorite('non-existent')).not.toThrow()
    expect(isFavorite('non-existent')).toBe(false)
  })

  test('toggleFavorite 切换收藏状态', () => {
    const { toggleFavorite, isFavorite } = useFavorites()
    expect(isFavorite('page-1')).toBe(false)
    toggleFavorite('page-1')
    expect(isFavorite('page-1')).toBe(true)
    toggleFavorite('page-1')
    expect(isFavorite('page-1')).toBe(false)
  })

  test('favoritePages 返回收藏的页面列表', async () => {
    const mockPage = {
      id: 'page-1',
      title: 'Test Page',
      type: 'normal',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    
    vi.mocked(usePageStore).mockReturnValue({
      pages: [mockPage],
      getPage: vi.fn((id: string) => id === 'page-1' ? mockPage : undefined)
    } as any)

    const { addFavorite, favoritePages } = useFavorites()
    addFavorite('page-1')
    expect(favoritePages.value.length).toBe(1)
    expect(favoritePages.value[0].id).toBe('page-1')
  })

  test('favoritePages 过滤不存在的页面', async () => {
    vi.mocked(usePageStore).mockReturnValue({
      pages: [],
      getPage: vi.fn(() => undefined)
    } as any)

    const { addFavorite, favoritePages } = useFavorites()
    addFavorite('non-existent')
    expect(favoritePages.value).toEqual([])
  })

  test('多个实例共享同一状态（单例）', () => {
    const instance1 = useFavorites()
    const instance2 = useFavorites()
    
    instance1.addFavorite('page-1')
    expect(instance2.isFavorite('page-1')).toBe(true)
    
    instance2.removeFavorite('page-1')
    expect(instance1.isFavorite('page-1')).toBe(false)
  })
})
