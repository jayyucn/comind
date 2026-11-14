import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * 删除查询块时，其 per-block 命名视图必须挂上孤儿标记（配置不随块删除消失，
 * 因为块是软删且可撤销）。收口点必须是 `deleteBlocks` —— 所有删除路径
 * （Backspace / 菜单 / 剪切 / 批量）都经过它，挂到各调用方必漏。
 */
const { mockMarkOrphan } = vi.hoisted(() => ({
  mockMarkOrphan: vi.fn(async () => 2),
}))

vi.mock('../services/query-view-namespace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/query-view-namespace')>()
  return { ...actual, markQueryViewOrphan: mockMarkOrphan }
})

vi.mock('../wasm/client', () => ({
  initCoreClient: vi.fn(async () => ({
    executeBatch: vi.fn(async () => []),
    saveBlockTree: vi.fn(async () => []),
    getFieldValues: vi.fn(async () => []),
    setFieldValue: vi.fn(),
    getBlocksByPage: vi.fn(async () => []),
    getPageWithBlocks: vi.fn(async () => null),
  })),
  getCoreClient: vi.fn(),
  isTauriEnvironment: vi.fn(() => false),
}))

describe('deleteBlocks — 查询块命名空间的孤儿标记', () => {
  let useBlockStore: typeof import('./blocks').useBlockStore

  beforeEach(async () => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useBlockStore = (await import('./blocks')).useBlockStore
  })

  test('删除 query 块 → 用其 id 挂孤儿标记', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'
    const queryBlock = await store.createBlock({ pageId, content: '', type: 'query' })
    await store.createBlock({ pageId, content: '另一块' })

    await store.deleteBlock(queryBlock.id)

    expect(mockMarkOrphan).toHaveBeenCalledTimes(1)
    expect(mockMarkOrphan).toHaveBeenCalledWith(queryBlock.id)
  })

  test('删除普通块 → 不触发命名空间搬运（不是每种块都有 per-block 配置）', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'
    const text = await store.createBlock({ pageId, content: '正文' })
    await store.createBlock({ pageId, content: '另一块' })

    await store.deleteBlock(text.id)

    expect(mockMarkOrphan).not.toHaveBeenCalled()
  })

  test('批量删除命中多个 query 块 → 逐个标记', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'
    const a = await store.createBlock({ pageId, content: '', type: 'query' })
    const b = await store.createBlock({ pageId, content: '', type: 'query' })
    await store.createBlock({ pageId, content: '保留块' })

    await store.deleteBlock(a.id)
    await store.deleteBlock(b.id)

    expect(mockMarkOrphan.mock.calls.map((c) => c[0])).toEqual([a.id, b.id])
  })
})
