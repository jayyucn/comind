import { describe, test, expect, beforeEach, vi } from 'vitest'
import { useNavigateToTag } from './useNavigateToTag'

const mockPush = vi.fn()

vi.mock('vue-router', () => ({
  useRouter: vi.fn(() => ({
    push: mockPush,
  })),
}))

beforeEach(() => {
  mockPush.mockClear()
})

describe('useNavigateToTag', () => {
  test('navigateToTag 跳转到标签聚合页（URL 须与 /tags/:tagId 路由对齐）', async () => {
    const { navigateToTag } = useNavigateToTag()
    await navigateToTag('t-project')

    expect(mockPush).toHaveBeenCalledWith('/tags/t-project')
  })

  test('navigateToTag 对特殊字符做编码', async () => {
    const { navigateToTag } = useNavigateToTag()
    await navigateToTag('t a/b')

    expect(mockPush).toHaveBeenCalledWith('/tags/t%20a%2Fb')
  })

  test('tagId 为空时不跳转（避免落到 /tags/ 空参路由）', async () => {
    const { navigateToTag } = useNavigateToTag()
    await navigateToTag('')

    expect(mockPush).not.toHaveBeenCalled()
  })

  test('navigateToTagLibrary 跳转到标签管理页', async () => {
    const { navigateToTagLibrary } = useNavigateToTag()
    await navigateToTagLibrary()

    expect(mockPush).toHaveBeenCalledWith('/tags')
  })
})
