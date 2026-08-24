import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { BlockClipPayload } from '../types/block'

// Mock WASM client（pasteBlocks 会 flushSave + setProperty，需完整 mock）
const {
  mockInitCoreClient,
  mockSaveBlockTree,
  mockSetProperty,
  mockGetProperties,
} = vi.hoisted(() => ({
  mockInitCoreClient: vi.fn(),
  mockSaveBlockTree: vi.fn(),
  mockSetProperty: vi.fn(),
  mockGetProperties: vi.fn(),
}))

vi.mock('../wasm/client', () => ({
  initCoreClient: mockInitCoreClient,
  getCoreClient: vi.fn(),
  isTauriEnvironment: vi.fn(() => false),
}))

function payload(content: string, children: BlockClipPayload[] = [], extra: Partial<BlockClipPayload> = {}): BlockClipPayload {
  return { content, type: 'bullet', format: null, properties: null, children, ...extra }
}

describe('pasteBlocks（ADR-0025 D6/D7/D8/D11）', () => {
  let useBlockStore: typeof import('./blocks').useBlockStore

  beforeEach(async () => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()

    const mockClient = {
      saveBlockTree: mockSaveBlockTree,
      setProperty: mockSetProperty,
      getProperties: mockGetProperties,
      getPageWithBlocks: vi.fn().mockResolvedValue(null),
      getBlocksByPage: vi.fn().mockResolvedValue([]),
      getPage: vi.fn(),
    }

    mockSaveBlockTree.mockImplementation(async (updates: Array<{ id: string; content: string }>) => [
      { id: updates[0].id, block: { id: updates[0].id, content: updates[0].content }, render_segments: [], snapshot: null },
    ])
    mockSetProperty.mockImplementation(async (blockId: string, key: string, value: string, type: string) => ({
      id: `prop-${blockId}-${key}`,
      block_id: blockId,
      key,
      value: String(value),
      type,
      sort_order: 0,
      is_hidden: 0,
      is_deleted: 0,
      schema_version: 1,
      created_at: 0,
      updated_at: 0,
    }))
    mockGetProperties.mockResolvedValue([])

    mockInitCoreClient.mockResolvedValue(mockClient)

    useBlockStore = (await import('./blocks')).useBlockStore
  })

  test('单块粘贴在锚点之后，id 重生成、内容/类型保真', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const a = await store.createBlock({ pageId, content: 'A' })
    const b = await store.createBlock({ pageId, content: 'B' })

    const created = await store.pasteBlocks(
      [payload('粘贴内容', [], { type: 'code' })],
      { pageId, anchorBlockId: b.id },
    )

    expect(created).toHaveLength(1)
    expect(created[0].id).not.toBe(b.id)
    expect(created[0].content).toBe('粘贴内容')
    expect(created[0].type).toBe('code')
    expect(created[0].parentId).toBe(b.parentId)
    // 插在 B 之后、且在 B 的后继之前
    expect(created[0].pos).toBeGreaterThan(b.pos)
    expect(a.pos).toBeLessThan(created[0].pos)
    // 落库被 flush（FK 前置条件）
    expect(mockSaveBlockTree).toHaveBeenCalled()
  })

  test('子树粘贴还原层级，format 保留，properties 逐条重建', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const anchor = await store.createBlock({ pageId, content: '锚点' })

    const created = await store.pasteBlocks(
      [
        payload('父块', [payload('子块')], {
          format: { type: 'heading', level: 2 },
          properties: { status: { value: 'Todo', type: 'string' }, priority: { value: 'high', type: 'string' } },
        }),
      ],
      { pageId, anchorBlockId: anchor.id },
    )

    expect(created).toHaveLength(2)
    const [parent, child] = created
    expect(child.parentId).toBe(parent.id)
    expect(parent.format).toEqual({ type: 'heading', level: 2 })
    expect(mockSetProperty).toHaveBeenCalledWith(parent.id, 'status', 'Todo', 'string')
    expect(mockSetProperty).toHaveBeenCalledWith(parent.id, 'priority', 'high', 'string')
  })

  test('无锚点时追加到 fallbackParentId 末尾', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const existing = await store.createBlock({ pageId, content: '已有', parentId: 'root-x' })

    const created = await store.pasteBlocks(
      [payload('新块1'), payload('新块2')],
      { pageId, fallbackParentId: 'root-x' },
    )

    expect(created).toHaveLength(2)
    expect(created.every(b => b.parentId === 'root-x')).toBe(true)
    expect(created[0].pos).toBeGreaterThan(existing.pos)
    expect(created[1].pos).toBeGreaterThan(created[0].pos)
  })

  test('多个顶层根按源顺序依次插入锚点后（sibling 组）', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const anchor = await store.createBlock({ pageId, content: '锚' })
    const c = await store.createBlock({ pageId, content: 'C' })

    const created = await store.pasteBlocks(
      [payload('根1'), payload('根2')],
      { pageId, anchorBlockId: anchor.id },
    )

    expect(created).toHaveLength(2)
    // 均插在锚点与 C 之间
    expect(created[0].pos).toBeGreaterThan(anchor.pos)
    expect(created[1].pos).toBeGreaterThan(created[0].pos)
    expect(created.every(b => b.pos < c.pos)).toBe(true)
    expect(created.every(b => b.parentId === anchor.parentId)).toBe(true)
  })

  test('子树内部自引用重映射到新 id，外部引用保持原样（D6）', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const anchor = await store.createBlock({ pageId, content: '锚' })

    const forest: BlockClipPayload[] = [{
      id: 'o1',
      content: '引用 o1 和 o2 与 ext-999',
      type: 'bullet',
      format: null,
      properties: null,
      children: [{ id: 'o2', content: '目标块', type: 'bullet', format: null, properties: null, children: [] }],
    }]

    const created = await store.pasteBlocks(forest, { pageId, anchorBlockId: anchor.id })

    const [parent, child] = created
    // 'o1'（自身旧 id）与 'o2'（子块旧 id）都被重映射
    expect(parent.content).toContain(child.id)
    expect(parent.content).not.toMatch(/\bo1\b/)
    expect(parent.content).not.toMatch(/\bo2\b/)
    // 外部引用不动
    expect(parent.content).toContain('ext-999')
    expect(parent.content).toContain('引用')
    expect(parent.content).toContain('与')
  })

  test('空森林直接返回空数组', async () => {
    const store = useBlockStore()
    const created = await store.pasteBlocks([], { pageId: 'page-1' })
    expect(created).toEqual([])
  })
})
