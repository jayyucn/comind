import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

const mockGetPage = vi.fn()
const mockGetPageByTitle = vi.fn()

vi.mock('../stores/pages', () => ({
  usePageStore: () => ({
    getPage: mockGetPage,
    getPageByTitle: mockGetPageByTitle,
  }),
}))

import { useIdeasFreeze } from './useIdeasFreeze'

beforeEach(() => {
  setActivePinia(createPinia())
  mockGetPage.mockReset()
  mockGetPageByTitle.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

function makePage(overrides: Record<string, any> = {}) {
  return {
    id: 'page-1',
    title: 'Test Page',
    type: 'normal' as const,
    ...overrides,
  }
}

describe('useIdeasFreeze — 基础冻结逻辑', () => {
  it('非 ideas 页面不冻结', () => {
    mockGetPage.mockReturnValue(makePage({ type: 'normal' }))
    const result = useIdeasFreeze(ref('page-1'))
    expect(result.isIdeasPage.value).toBe(false)
    expect(result.isFrozen.value).toBe(false)
  })

  it('今日的 ideas 页面不冻结（系统时间匹配页面标题日期）', () => {
    vi.useFakeTimers()
    const today = new Date(2026, 6, 15) // July 15, 2026
    vi.setSystemTime(today)

    const todayStr = '2026-07-15'
    mockGetPageByTitle.mockReturnValue(makePage({ type: 'ideas', title: todayStr }))
    const result = useIdeasFreeze(ref(todayStr))
    expect(result.isIdeasPage.value).toBe(true)
    expect(result.isToday.value).toBe(true)
    expect(result.isFrozen.value).toBe(false)
  })

  it('非今日的 ideas 页面冻结', () => {
    vi.useFakeTimers()
    const today = new Date(2026, 6, 15)
    vi.setSystemTime(today)

    const yesterday = '2026-07-14'
    mockGetPageByTitle.mockReturnValue(makePage({ type: 'ideas', title: yesterday }))
    const result = useIdeasFreeze(ref(yesterday))
    expect(result.isIdeasPage.value).toBe(true)
    expect(result.isToday.value).toBe(false)
    expect(result.isFrozen.value).toBe(true)
  })

  it('未来日期的 ideas 页面冻结', () => {
    vi.useFakeTimers()
    const today = new Date(2026, 6, 15)
    vi.setSystemTime(today)

    const future = '2026-07-20'
    mockGetPageByTitle.mockReturnValue(makePage({ type: 'ideas', title: future }))
    const result = useIdeasFreeze(ref(future))
    expect(result.isFrozen.value).toBe(true)
  })

  it('无匹配页面时返回未冻结', () => {
    mockGetPage.mockReturnValue(null)
    mockGetPageByTitle.mockReturnValue(null)
    const result = useIdeasFreeze(ref('nonexistent'))
    expect(result.currentPage.value).toBeNull()
    expect(result.isIdeasPage.value).toBe(false)
    expect(result.isFrozen.value).toBe(false)
  })
})

describe('useIdeasFreeze — parseToDate 格式解析', () => {
  it('解析 yyyy-MM-dd 格式为今日', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 15))

    mockGetPageByTitle.mockReturnValue(makePage({ type: 'ideas', title: '2026-07-15' }))
    const result = useIdeasFreeze(ref('2026-07-15'))
    expect(result.isToday.value).toBe(true)
  })

  it('解析 yyyy/MM/dd 格式为今日', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 15))

    mockGetPageByTitle.mockReturnValue(makePage({ type: 'ideas', title: '2026/07/15' }))
    const result = useIdeasFreeze(ref('2026/07/15'))
    expect(result.isToday.value).toBe(true)
  })

  it('解析 yyyy年M月d日 格式为今日', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 15))

    mockGetPageByTitle.mockReturnValue(makePage({ type: 'ideas', title: '2026年7月15日' }))
    const result = useIdeasFreeze(ref('2026年7月15日'))
    expect(result.isToday.value).toBe(true)
  })

  it('无法解析的标题返回非今日', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 15))

    mockGetPageByTitle.mockReturnValue(makePage({ type: 'ideas', title: '非日期标题' }))
    const result = useIdeasFreeze(ref('非日期标题'))
    expect(result.isToday.value).toBe(false)
    expect(result.isFrozen.value).toBe(true)
  })

  it('空字符串标题无法解析为今天', () => {
    mockGetPageByTitle.mockReturnValue(makePage({ type: 'ideas', title: '' }))
    const result = useIdeasFreeze(ref(''))
    // 空字符串 parseToDate 返回 null → isToday 为 false
    expect(result.isToday.value).toBe(false)
  })
})

describe('useIdeasFreeze — pageIdRef 来源', () => {
  it('支持 string 类型 pageIdRef', () => {
    mockGetPage.mockReturnValue(makePage({ type: 'normal' }))
    const result = useIdeasFreeze('page-1')
    expect(result.currentPage.value?.id).toBe('page-1')
  })

  it('支持 Ref<string> 类型 pageIdRef', () => {
    mockGetPage.mockReturnValue(makePage({ type: 'normal' }))
    const pageIdRef = ref('page-1')
    const result = useIdeasFreeze(pageIdRef)
    expect(result.currentPage.value?.id).toBe('page-1')
  })

  it('未提供 pageIdRef 时返回未冻结', () => {
    const result = useIdeasFreeze()
    expect(result.currentPage.value).toBeNull()
    expect(result.isIdeasPage.value).toBe(false)
    expect(result.isFrozen.value).toBe(false)
  })

  it('pageIdRef 为 null/undefined 时返回未冻结', () => {
    const result = useIdeasFreeze(ref(null as any))
    expect(result.currentPage.value).toBeNull()
    expect(result.isFrozen.value).toBe(false)
  })
})

describe('useIdeasFreeze — getPage vs getPageByTitle 查找', () => {
  it('优先用 getPage(id) 查找', () => {
    mockGetPage.mockReturnValue(makePage({ id: 'page-1', type: 'normal' }))
    const result = useIdeasFreeze('page-1')
    expect(result.currentPage.value?.id).toBe('page-1')
    expect(mockGetPage).toHaveBeenCalledWith('page-1')
  })

  it('getPage(id) 返回 null 时回退到 getPageByTitle', () => {
    mockGetPage.mockReturnValue(null)
    mockGetPageByTitle.mockReturnValue(makePage({ id: 'page-2', type: 'normal' }))
    const result = useIdeasFreeze('2026-07-15')
    expect(result.currentPage.value?.id).toBe('page-2')
  })
})
