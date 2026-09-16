import { describe, test, expect, beforeEach, vi } from 'vitest'
import { useNavigateToPage } from './useNavigateToPage'

const mockPush = vi.fn()
const mockNormalizeJournalTitle = vi.fn<(title: string) => Promise<string | null>>()

vi.mock('vue-router', () => ({
  useRouter: vi.fn(() => ({
    push: mockPush
  }))
}))

// S6: normalizeJournalTitle 已迁移到 Rust，经 getCoreClient() 调用
vi.mock('../wasm/client', () => ({
  getCoreClient: vi.fn(() => ({
    normalizeJournalTitle: mockNormalizeJournalTitle
  }))
}))

beforeEach(() => {
  mockPush.mockClear()
  mockNormalizeJournalTitle.mockReset()
})

describe('useNavigateToPage', () => {
  test('navigateToPage 跳转到普通页面', async () => {
    mockNormalizeJournalTitle.mockResolvedValue(null)

    const { navigateToPage } = useNavigateToPage()
    await navigateToPage('My Page')

    expect(mockPush).toHaveBeenCalledWith('/page/My%20Page')
  })

  test('navigateToPage 跳转到日记页面', async () => {
    mockNormalizeJournalTitle.mockResolvedValue('2026-04-26')

    const { navigateToPage } = useNavigateToPage()
    await navigateToPage('2026-04-26')

    expect(mockPush).toHaveBeenCalledWith('/ideas/2026-04-26')
  })

  test('navigateToPage 对 URL 特殊字符进行编码', async () => {
    mockNormalizeJournalTitle.mockResolvedValue(null)

    const { navigateToPage } = useNavigateToPage()
    await navigateToPage('Page with spaces & special chars!')

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('/page/'))
  })

  test('navigateToPage 使用 UUID 直接跳转', async () => {
    mockNormalizeJournalTitle.mockResolvedValue(null)

    const { navigateToPage } = useNavigateToPage()
    await navigateToPage('550e8400-e29b-41d4-a716-446655440000')

    expect(mockPush).toHaveBeenCalledWith('/page/550e8400-e29b-41d4-a716-446655440000')
  })
})
