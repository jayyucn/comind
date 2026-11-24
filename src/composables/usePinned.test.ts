import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePinned } from './usePinned'
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

describe('usePinned', () => {
  test('初始置顶列表为空', () => {
    const { pinnedPages } = usePinned()
    expect(pinnedPages.value).toEqual([])
  })

  test('isPinned 检查置顶状态', () => {
    const { isPinned, addPin } = usePinned()
    expect(isPinned('page-1')).toBe(false)
    addPin('page-1')
    expect(isPinned('page-1')).toBe(true)
  })

  test('addPin 添加页面到置顶', () => {
    const { addPin, isPinned } = usePinned()
    addPin('page-1')
    expect(isPinned('page-1')).toBe(true)
  })

  test('addPin 重复添加同一页面无操作', () => {
    const { addPin, isPinned } = usePinned()
    addPin('page-1')
    addPin('page-1')
    expect(isPinned('page-1')).toBe(true)
  })

  test('removePin 从置顶移除页面', () => {
    const { addPin, removePin, isPinned } = usePinned()
    addPin('page-1')
    expect(isPinned('page-1')).toBe(true)
    removePin('page-1')
    expect(isPinned('page-1')).toBe(false)
  })

  test('removePin 移除不存在的页面无操作', () => {
    const { removePin, isPinned } = usePinned()
    expect(() => removePin('non-existent')).not.toThrow()
    expect(isPinned('non-existent')).toBe(false)
  })

  test('togglePin 切换置顶状态', () => {
    const { togglePin, isPinned } = usePinned()
    expect(isPinned('page-1')).toBe(false)
    togglePin('page-1')
    expect(isPinned('page-1')).toBe(true)
    togglePin('page-1')
    expect(isPinned('page-1')).toBe(false)
  })

  test('pinnedPages 返回置顶的页面列表', async () => {
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

    const { addPin, pinnedPages } = usePinned()
    addPin('page-1')
    expect(pinnedPages.value.length).toBe(1)
    expect(pinnedPages.value[0].id).toBe('page-1')
  })

  test('pinnedPages 过滤不存在的页面', async () => {
    vi.mocked(usePageStore).mockReturnValue({
      pages: [],
      getPage: vi.fn(() => undefined)
    } as any)

    const { addPin, pinnedPages } = usePinned()
    addPin('non-existent')
    expect(pinnedPages.value).toEqual([])
  })

  test('多个实例共享同一状态（单例）', () => {
    const instance1 = usePinned()
    const instance2 = usePinned()

    instance1.addPin('page-1')
    expect(instance2.isPinned('page-1')).toBe(true)

    instance2.removePin('page-1')
    expect(instance1.isPinned('page-1')).toBe(false)
  })
})
