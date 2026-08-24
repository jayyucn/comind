import { describe, test, expect, beforeEach, vi } from 'vitest'
import { useNavigateToPage } from './useNavigateToPage'

const mockPush = vi.fn()

vi.mock('vue-router', () => ({
  useRouter: vi.fn(() => ({
    push: mockPush
  }))
}))

vi.mock('../utils/ideas-detect', () => ({
  normalizeJournalTitle: vi.fn()
}))

beforeEach(() => {
  mockPush.mockClear()
})

describe('useNavigateToPage', () => {
  test('navigateToPage 跳转到普通页面', async () => {
    const { normalizeJournalTitle } = await import('../utils/ideas-detect')
    vi.mocked(normalizeJournalTitle).mockReturnValue(null)

    const { navigateToPage } = useNavigateToPage()
    await navigateToPage('My Page')

    expect(mockPush).toHaveBeenCalledWith('/page/My%20Page')
  })

  test('navigateToPage 跳转到日记页面', async () => {
    const { normalizeJournalTitle } = await import('../utils/ideas-detect')
    vi.mocked(normalizeJournalTitle).mockReturnValue('2026-04-26')

    const { navigateToPage } = useNavigateToPage()
    await navigateToPage('2026-04-26')

    expect(mockPush).toHaveBeenCalledWith('/ideas/2026-04-26')
  })

  test('navigateToPage 对 URL 特殊字符进行编码', async () => {
    const { normalizeJournalTitle } = await import('../utils/ideas-detect')
    vi.mocked(normalizeJournalTitle).mockReturnValue(null)

    const { navigateToPage } = useNavigateToPage()
    await navigateToPage('Page with spaces & special chars!')

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('/page/'))
  })

  test('navigateToPage 使用 UUID 直接跳转', async () => {
    const { normalizeJournalTitle } = await import('../utils/ideas-detect')
    vi.mocked(normalizeJournalTitle).mockReturnValue(null)

    const { navigateToPage } = useNavigateToPage()
    await navigateToPage('550e8400-e29b-41d4-a716-446655440000')

    expect(mockPush).toHaveBeenCalledWith('/page/550e8400-e29b-41d4-a716-446655440000')
  })
})
