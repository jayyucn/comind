/**
 * tags store 单测（ADR-0050 D10）。
 *
 * 接缝纪律：**只 mock `src/wasm/client` 边界**，其上的 tags / blockCard 两个真
 * Pinia store 全真（先例 `blockCard.test.ts`）。解析结果（有效字段 / 后代闭包）
 * 是 Rust 侧产物 —— 测试只喂「Rust 会给什么」，不重算、不替它实现。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { PersistedTagTreeEntry, PersistedFieldDefinition } from '../../types/tag-persisted'
import type { BlockCard } from '../../wasm/types'

const { mockInitCoreClient, mockClient } = vi.hoisted(() => {
  const mockClient = {
    getTagTree: vi.fn(),
    getFieldDefinitions: vi.fn(),
    createTag: vi.fn(),
    updateTag: vi.fn(),
    deleteTag: vi.fn(),
    setTagParent: vi.fn(),
    createFieldDefinition: vi.fn(),
    updateFieldDefinition: vi.fn(),
    deleteFieldDefinition: vi.fn(),
    getBlockCards: vi.fn(),
  }
  return { mockInitCoreClient: vi.fn(), mockClient }
})

vi.mock('../../wasm/client', () => ({
  initCoreClient: mockInitCoreClient,
  getCoreClient: vi.fn(),
}))

function treeEntry(
  over: Partial<PersistedTagTreeEntry> & { id: string; title: string },
): PersistedTagTreeEntry {
  return {
    field_ids: [],
    parent_id: null,
    is_system: false,
    created_at: 1,
    updated_at: 1,
    version: 0,
    deleted_at: null,
    effective_field_ids: [],
    descendant_ids: [],
    ...over,
  }
}

function fieldDef(
  over: Partial<PersistedFieldDefinition> & { id: string; title: string },
): PersistedFieldDefinition {
  return {
    key: over.id,
    type: 'string',
    closed_values: null,
    is_system: false,
    created_at: 1,
    updated_at: 1,
    version: 0,
    deleted_at: null,
    ...over,
  }
}

function makeCard(over: Partial<BlockCard> = {}): BlockCard {
  return {
    block_id: 'block-1',
    page_id: 'page-1',
    parent_id: 'page-1',
    content_preview: 'Test content',
    properties: {},
    date_refs: [],
    tags: [],
    updated_at: 1000,
    created_at: 1000,
    ...over,
  }
}

describe('tags store', () => {
  let useTagsStore: typeof import('../tags').useTagsStore
  let useBlockCardStore: typeof import('../blockCard').useBlockCardStore

  beforeEach(async () => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()

    vi.doMock('../../wasm/client', () => ({
      initCoreClient: mockInitCoreClient,
      getCoreClient: vi.fn(),
    }))

    const tagsModule = await import('../tags')
    useTagsStore = tagsModule.useTagsStore
    useBlockCardStore = (await import('../blockCard')).useBlockCardStore

    mockClient.getTagTree.mockResolvedValue([])
    mockClient.getFieldDefinitions.mockResolvedValue([])
    mockClient.getBlockCards.mockResolvedValue([])
    mockInitCoreClient.mockResolvedValue(mockClient)
  })

  // ── 读 ──

  it('ensureLoaded 同批拉标签树与字段定义，且幂等（force 才重读）', async () => {
    mockClient.getTagTree.mockResolvedValue([treeEntry({ id: 't1', title: '项目' })])
    mockClient.getFieldDefinitions.mockResolvedValue([fieldDef({ id: 'f1', title: '状态' })])

    const store = useTagsStore()
    await store.ensureLoaded()

    expect(store.tags.map((t) => t.title)).toEqual(['项目'])
    expect(store.getFieldDefinition('f1')?.title).toBe('状态')

    await store.ensureLoaded()
    expect(mockClient.getTagTree).toHaveBeenCalledTimes(1)

    await store.ensureLoaded(true)
    expect(mockClient.getTagTree).toHaveBeenCalledTimes(2)
  })

  it('有效字段与命中集合直接消费 Rust 解析结果（store 不重算继承）', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({
        id: 'p',
        title: '任务',
        field_ids: ['f1'],
        effective_field_ids: ['f1'],
        descendant_ids: ['c'],
      }),
      treeEntry({
        id: 'c',
        title: '开发任务',
        field_ids: ['f9'],
        parent_id: 'p',
        // 自身字段在前、父字段在后（Rust 侧「自身 > 直接父」口径）
        effective_field_ids: ['f9', 'f1'],
        descendant_ids: [],
      }),
    ])

    const store = useTagsStore()
    await store.ensureLoaded()

    expect(store.effectiveFieldIds('c')).toEqual(['f9', 'f1'])
    expect(store.ownFieldIds('c')).toEqual(['f9'])
    expect(store.memberTagIds('p')).toEqual(['p', 'c'])
    expect(store.memberTagIds('c')).toEqual(['c'])
    expect(store.parentTagOf('c')?.title).toBe('任务')
    expect(store.childTags('p').map((t) => t.id)).toEqual(['c'])
  })

  it('有效字段定义按解析顺序取标题/类型，缺失定义静默跳过', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 'c', title: '开发任务', effective_field_ids: ['f9', 'gone', 'f1'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f9', title: '工时', type: 'number' }),
      fieldDef({ id: 'f1', title: '状态' }),
    ])

    const store = useTagsStore()
    await store.ensureLoaded()

    expect(store.effectiveFieldDefinitions('c').map((d) => d.title)).toEqual(['工时', '状态'])
    expect(store.effectiveFieldDefinitions('c')[0].type).toBe('number')
  })

  it('parentCandidates 排除自身与全部后代（环守卫在 Rust，UI 不递必拒项）', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 'p', title: '任务', descendant_ids: ['c'] }),
      treeEntry({ id: 'c', title: '开发任务', parent_id: 'p' }),
      treeEntry({ id: 'other', title: '其他' }),
    ])

    const store = useTagsStore()
    await store.ensureLoaded()

    expect(store.parentCandidates('p').map((t) => t.id)).toEqual(['other'])
  })

  it('fieldOrigin 回溯字段归属标签（供继承/自身徽标），不自造优先级规则', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 'g', title: '祖先', field_ids: ['f0'] }),
      treeEntry({
        id: 'p',
        title: '父',
        field_ids: ['f1'],
        parent_id: 'g',
        effective_field_ids: ['f1', 'f0'],
      }),
      treeEntry({
        id: 'c',
        title: '子',
        field_ids: ['f2'],
        parent_id: 'p',
        effective_field_ids: ['f2', 'f1', 'f0'],
      }),
    ])

    const store = useTagsStore()
    await store.ensureLoaded()

    expect(store.fieldOrigin('c', 'f2')?.id).toBe('c')
    expect(store.fieldOrigin('c', 'f1')?.id).toBe('p')
    // 跨代继承：来源是祖先而非直接父
    expect(store.fieldOrigin('c', 'f0')?.id).toBe('g')
    // 全链未声明的 id（悬空引用）→ 无归属
    expect(store.fieldOrigin('c', 'ghost')).toBeUndefined()
  })

  it('tags 投影带 is_system（系统标签拒删守卫在 UI 侧依赖它）', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 'sys', title: '系统任务', is_system: true }),
      treeEntry({ id: 'u', title: '我的标签' }),
    ])

    const store = useTagsStore()
    await store.ensureLoaded()

    expect(store.getTagById('sys')?.is_system).toBe(true)
    expect(store.getTagById('u')?.is_system).toBe(false)
  })

  // ── 成员派生（投影自 blockCard，零新列） ──

  it('直系 vs 含后代：成员数与来源页数两套口径', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 'p', title: '任务', descendant_ids: ['c'] }),
      treeEntry({ id: 'c', title: '开发任务', parent_id: 'p' }),
    ])
    mockClient.getBlockCards.mockResolvedValue([
      makeCard({ block_id: 'a', page_id: 'page-1', tags: ['p'] }),
      makeCard({ block_id: 'b', page_id: 'page-2', tags: ['c'] }),
      makeCard({ block_id: 'z', page_id: 'page-3', tags: ['unrelated'] }),
    ])

    const cardStore = useBlockCardStore()
    await cardStore.load()
    const store = useTagsStore()
    await store.ensureLoaded()

    // 管理页口径：只数直系
    expect(store.memberSummary('p', 'direct')).toEqual({ count: 1, pageCount: 1 })
    // 聚合页口径：自身 + 后代闭包，按 page_id 去重
    expect(store.memberSummary('p', 'aggregate')).toEqual({ count: 2, pageCount: 2 })
    expect(store.memberSummary('c', 'aggregate')).toEqual({ count: 1, pageCount: 1 })
  })

  it('未使用 = 直系成员 0；最近使用按成员块 updated_at 降序', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 'old', title: '旧' }),
      treeEntry({ id: 'fresh', title: '新' }),
      treeEntry({ id: 'none', title: '没人用' }),
    ])
    mockClient.getBlockCards.mockResolvedValue([
      makeCard({ block_id: 'a', page_id: 'page-1', tags: ['old'], updated_at: 100 }),
      makeCard({ block_id: 'b', page_id: 'page-2', tags: ['fresh'], updated_at: 900 }),
    ])

    await useBlockCardStore().load()
    const store = useTagsStore()
    await store.ensureLoaded()

    expect(store.unusedTags().map((t) => t.id)).toEqual(['none'])
    expect(store.recentTags().map((t) => t.id)).toEqual(['fresh', 'old', 'none'])
    expect(store.lastUsedAt('fresh')).toBe(900)
    expect(store.lastUsedAt('none')).toBe(0)
  })

  // ── 写（写后整体重读） ──

  it('createTag 走 client 并重读标签树', async () => {
    mockClient.createTag.mockResolvedValue(treeEntry({ id: 'new', title: '读书' }))

    const store = useTagsStore()
    await store.ensureLoaded()
    await store.createTag({ title: '读书', parent_id: null })

    expect(mockClient.createTag).toHaveBeenCalledWith({ title: '读书', parent_id: null })
    expect(mockClient.getTagTree).toHaveBeenCalledTimes(2)
  })

  it('setParent 传单父（null = 清空回顶级）', async () => {
    mockClient.setTagParent.mockResolvedValue(treeEntry({ id: 'c', title: '开发任务' }))

    const store = useTagsStore()
    await store.setParent('c', 'p')
    expect(mockClient.setTagParent).toHaveBeenCalledWith({ id: 'c', parent_id: 'p' })

    await store.setParent('c', null)
    expect(mockClient.setTagParent).toHaveBeenLastCalledWith({ id: 'c', parent_id: null })
  })

  it('deleteTag 走 client 并重读', async () => {
    const store = useTagsStore()
    await store.deleteTag('c')

    expect(mockClient.deleteTag).toHaveBeenCalledWith('c')
    expect(mockClient.getTagTree).toHaveBeenCalled()
  })

  it('addFieldToTag 先建字段定义、再追加进该标签自身字段', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't1', title: '项目', field_ids: ['f9'] }),
    ])
    mockClient.createFieldDefinition.mockResolvedValue(fieldDef({ id: 'def-1', title: '工时' }))

    const store = useTagsStore()
    await store.ensureLoaded()
    await store.addFieldToTag('t1', { title: '工时', type: 'number' })

    const arg = mockClient.createFieldDefinition.mock.calls[0][0]
    expect(arg.title).toBe('工时')
    expect(arg.type).toBe('number')
    expect(mockClient.updateTag).toHaveBeenCalledWith({ id: 't1', field_ids: ['f9', 'def-1'] })
  })

  it('removeFieldFromTag 只解除引用，不删字段定义（定义可能被其他标签复用）', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't1', title: '项目', field_ids: ['f9', 'def-1'] }),
    ])

    const store = useTagsStore()
    await store.ensureLoaded()
    await store.removeFieldFromTag('t1', 'def-1')

    expect(mockClient.updateTag).toHaveBeenCalledWith({ id: 't1', field_ids: ['f9'] })
    expect(mockClient.deleteFieldDefinition).not.toHaveBeenCalled()
  })

  it('updateFieldDefinition 改定义本身（标题/类型/候选值）并重读', async () => {
    mockClient.getTagTree.mockResolvedValue([treeEntry({ id: 't1', title: '项目' })])
    mockClient.updateFieldDefinition.mockResolvedValue(fieldDef({ id: 'def-1', title: '预计工时' }))

    const store = useTagsStore()
    await store.ensureLoaded()
    await store.updateFieldDefinition({ id: 'def-1', title: '预计工时', type: 'number' })

    expect(mockClient.updateFieldDefinition).toHaveBeenCalledWith({
      id: 'def-1',
      title: '预计工时',
      type: 'number',
    })
    // 写后重读（force），避免本地合并漂移
    expect(mockClient.getTagTree).toHaveBeenCalledTimes(2)
  })
})
