import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * `resetBlockToText`（块入口菜单「重置为文本块」）。
 *
 * 语义是「删块 + 同位置新建」，不是就地改字段 —— 就地改只会清正文/类型/format，
 * 块上仍挂着字段值与标签绑定，看起来并不空。撤销可回（ADR-0046 整页快照把两步合一）
 * 由 `useUndoHistory` 侧保证，这里只钉数据形状。
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
    deleteFieldValue: vi.fn(),
    getBlocksByPage: vi.fn(async () => []),
    getPageWithBlocks: vi.fn(async () => null),
  })),
  getCoreClient: vi.fn(),
  isTauriEnvironment: vi.fn(() => false),
}))

describe('resetBlockToText — 重置为空白文本块', () => {
  let useBlockStore: typeof import('./blocks').useBlockStore
  let useFieldValueStore: typeof import('./fieldValue').useFieldValueStore

  beforeEach(async () => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useBlockStore = (await import('./blocks')).useBlockStore
    useFieldValueStore = (await import('./fieldValue')).useFieldValueStore
  })

  test('表格块 → 旧块连同子块一起消失，同层级同位置出现空白 bullet', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'
    const before = await store.createBlock({ pageId, content: '上面的块' })
    const table = await store.createBlock({
      pageId,
      content: '',
      type: 'table',
      format: { table: { rows: [['a']], header: true } },
    })
    const after = await store.createBlock({ pageId, content: '下面的块' })
    await store.createBlock({ pageId, content: '表内子块', parentId: table.id, pos: 1000 })

    const created = await store.resetBlockToText(table.id)

    // 旧块（含子块）已不在 store 里
    expect(store.blocks.find(b => b.id === table.id)).toBeUndefined()
    expect(store.blocks.some(b => b.parentId === table.id)).toBe(false)

    // 新块：同一页、同一层级、同一 pos（视觉上就是原地清空）、内容与类型都干净
    expect(created).not.toBeNull()
    expect(created!.id).not.toBe(table.id)
    expect(created!.pageId).toBe(pageId)
    expect(created!.parentId).toBe(null)
    expect(created!.pos).toBe(table.pos)
    expect(created!.content).toBe('')
    expect(created!.type).toBe('text')
    // 类型专属配置（format.table）不能跟着新块活下来
    expect(created!.format).toEqual({})

    // 前后邻居还在原位（按文档序比，store.blocks 本身是插入序）
    const siblings = store.blocks
      .filter(b => b.pageId === pageId && !b.parentId)
      .sort((a, b) => a.pos - b.pos)
    expect(siblings.map(b => b.content)).toEqual(['上面的块', '', '下面的块'])
    expect(before.pos).toBeLessThan(created!.pos)
    expect(after.pos).toBeGreaterThan(created!.pos)
  })

  test('页里只剩这一块 → 闸门保留本块，就地重置并删掉字段值行', async () => {
    const store = useBlockStore()
    const fieldValueStore = useFieldValueStore()
    const pageId = 'page-1'
    const only = await store.createBlock({
      pageId,
      content: '',
      type: 'table',
      format: { table: { rows: [['a']] } },
    })
    fieldValueStore.fieldValuesByBlock.set(only.id, [
      {
        id: 'fv-1', block_id: only.id, field_definition_id: 'fd-status', key: 'status',
        value_json: '"Todo"', value_type: 'select', seq: 0,
        created_at: 0, updated_at: 0, version: 0, deleted_at: null,
      },
    ])

    const created = await store.resetBlockToText(only.id)

    // 删除被闸门拦住：同一个块留下，但已不是表格
    expect(created!.id).toBe(only.id)
    expect(store.blocks).toHaveLength(1)
    expect(created!.type).toBe('text')
    expect(created!.content).toBe('')
    expect(created!.format).toEqual({})
    // 字段值随删除一起消失（否则「空文本块」下面还挂着一行状态）
    expect(fieldValueStore.getBlockFieldValues(only.id)).toHaveLength(0)
  })

  test('块不存在 → 返回 null，不动任何东西', async () => {
    const store = useBlockStore()
    await store.createBlock({ pageId: 'page-1', content: '正文' })

    expect(await store.resetBlockToText('missing')).toBeNull()
    expect(store.blocks).toHaveLength(1)
  })

  test('查询块 → 命名视图命名空间挂孤儿标记（与删除同口径）', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'
    await store.createBlock({ pageId, content: '另一块' })
    const query = await store.createBlock({ pageId, content: '', type: 'query' })

    await store.resetBlockToText(query.id)

    expect(mockMarkOrphan).toHaveBeenCalledWith(query.id)
  })
})
