// 书房进度工具单测（票 08）：CFI 前缀 → 章节下标 → 近似百分比；批量加载编排。
// wasm client / tauri 平台检测 / epub-loader 全部 mock，隔离测试纯逻辑。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockInitCoreClient, mockGetBookProgress, mockLoadEpubFromStorage, mockIsTauri } = vi.hoisted(() => ({
  mockInitCoreClient: vi.fn(),
  mockGetBookProgress: vi.fn(),
  mockLoadEpubFromStorage: vi.fn(),
  mockIsTauri: vi.fn(),
}))

vi.mock('../wasm/client', () => ({ initCoreClient: mockInitCoreClient }))
vi.mock('../wasm/tauri-platform', () => ({ isTauriEnvironment: mockIsTauri }))
vi.mock('./epub-loader', () => ({ loadEpubFromStorage: mockLoadEpubFromStorage }))

import {
  sectionIndexFromCfi,
  sectionProgressPercent,
  progressPercentFromCfi,
  loadBookGalleryProgress,
} from './book-progress'

describe('sectionIndexFromCfi（CFI 前缀 → spine 章节下标）', () => {
  it('foliate 约定 N = (下标+1)*2：/6/14 → 下标 6', () => {
    expect(sectionIndexFromCfi('epubcfi(/6/14!/4/2/1:0)')).toBe(6)
  })

  it('仅 spine 前缀的短 CFI 也能解析：/6/4 → 下标 1', () => {
    expect(sectionIndexFromCfi('epubcfi(/6/4)')).toBe(1)
  })

  it('带 id 断言的前缀不受影响：/6/4[chap01ref] → 下标 1', () => {
    expect(sectionIndexFromCfi('epubcfi(/6/4[chap01ref]!/4/10/2:0)')).toBe(1)
  })

  it('range CFI（含逗号）取首个 spine 前缀：/6/10 → 下标 4', () => {
    expect(sectionIndexFromCfi('epubcfi(/6/10!/4,/2,/4)')).toBe(4)
  })

  it('空/非 CFI/步号非法（N<2）返回 null', () => {
    expect(sectionIndexFromCfi(null)).toBeNull()
    expect(sectionIndexFromCfi(undefined)).toBeNull()
    expect(sectionIndexFromCfi('')).toBeNull()
    expect(sectionIndexFromCfi('not-a-cfi')).toBeNull()
    expect(sectionIndexFromCfi('epubcfi(/6/1!/4)')).toBeNull()
    expect(sectionIndexFromCfi('epubcfi(/4/10)')).toBeNull()
  })
})

describe('sectionProgressPercent（章节下标 → 近似百分比）', () => {
  it('10 章读到第 5 章（下标 4）≈ 50%', () => {
    expect(sectionProgressPercent(4, 10)).toBe(0.5)
  })

  it('首章（下标 0）→ 1/总章数；末章 → 100%', () => {
    expect(sectionProgressPercent(0, 10)).toBe(0.1)
    expect(sectionProgressPercent(9, 10)).toBe(1)
  })

  it('下标越界钳制：过大 → 100%，负数 → 首章', () => {
    expect(sectionProgressPercent(99, 10)).toBe(1)
    expect(sectionProgressPercent(-3, 10)).toBe(0.1)
  })

  it('总章数非法（0/负/NaN）返回 null', () => {
    expect(sectionProgressPercent(3, 0)).toBeNull()
    expect(sectionProgressPercent(3, -1)).toBeNull()
    expect(sectionProgressPercent(3, NaN)).toBeNull()
  })
})

describe('progressPercentFromCfi（组合入口）', () => {
  it('10 章书停在 /6/10 前缀 → 50%', () => {
    expect(progressPercentFromCfi('epubcfi(/6/10!/4/2/1:0)', 10)).toBe(0.5)
  })

  it('无进度或 CFI 无法解析返回 null', () => {
    expect(progressPercentFromCfi(null, 10)).toBeNull()
    expect(progressPercentFromCfi('bad', 10)).toBeNull()
    expect(progressPercentFromCfi('epubcfi(/6/10!/…)', 0)).toBeNull()
  })
})

describe('loadBookGalleryProgress（书房批量进度加载）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInitCoreClient.mockResolvedValue({ getBookProgress: mockGetBookProgress })
    mockIsTauri.mockReturnValue(true)
    // 每个用例用独立书 id，绕开会话级章节总数缓存的跨用例串扰
    mockLoadEpubFromStorage.mockImplementation(async (id: string) => ({ sections: new Array(10) }))
  })

  it('有进度的书按 CFI+总章数得出百分比；无进度的书不出现在结果里', async () => {
    mockGetBookProgress.mockImplementation(async (id: string) =>
      id === 'b-progress' ? { book_page_id: id, cfi: 'epubcfi(/6/10!/4/2/1:0)', updated_at: 1 } : null,
    )

    const result = await loadBookGalleryProgress(['b-progress', 'b-fresh'])

    expect(result).toEqual({ 'b-progress': 0.5 })
    expect(mockGetBookProgress).toHaveBeenCalledTimes(2)
  })

  it('单本书解析失败（文件缺失/损坏）仅跳过该书，不影响其余', async () => {
    mockGetBookProgress.mockResolvedValue({ book_page_id: 'x', cfi: 'epubcfi(/6/10!/4/2/1:0)', updated_at: 1 })
    mockLoadEpubFromStorage.mockRejectedValueOnce(new Error('书文件为空或不存在'))

    const result = await loadBookGalleryProgress(['b-broken', 'b-ok'])

    expect(result).toEqual({ 'b-ok': 0.5 })
  })

  it('非 Tauri 环境直接返回空对象，不触碰 client 与书文件', async () => {
    mockIsTauri.mockReturnValue(false)

    const result = await loadBookGalleryProgress(['b-1'])

    expect(result).toEqual({})
    expect(mockInitCoreClient).not.toHaveBeenCalled()
    expect(mockGetBookProgress).not.toHaveBeenCalled()
  })

  it('空书单返回空对象', async () => {
    const result = await loadBookGalleryProgress([])
    expect(result).toEqual({})
    expect(mockInitCoreClient).not.toHaveBeenCalled()
  })

  it('同一本书的章节总数在会话内只解析一次（缓存）', async () => {
    mockGetBookProgress.mockResolvedValue({ book_page_id: 'b-cache', cfi: 'epubcfi(/6/10!/4/2/1:0)', updated_at: 1 })

    await loadBookGalleryProgress(['b-cache'])
    await loadBookGalleryProgress(['b-cache'])

    expect(mockLoadEpubFromStorage).toHaveBeenCalledTimes(1)
  })
})
