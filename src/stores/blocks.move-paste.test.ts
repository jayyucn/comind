import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { BlockClipPayload } from '../types/block'

/**
 * 粘贴的搬移分支（ADR-0025 D4b）。
 *
 * 判据全在 Rust（`move_blocks` 一个事务内校验 + 复活 + 换页），前端只做两件事：
 * 算落点、把「搬不动」翻译成回落新建。判据本身的覆盖在 `block_write::tests::move_blocks_*`，
 * 这里验的是**回落契约**与**内存回写**（少了任一条，用户会看到块凭空消失或两页各一份）。
 */
const { mockInitCoreClient, mockSaveBlockTree, mockGetProperties, mockMoveBlocks } = vi.hoisted(() => ({
  mockInitCoreClient: vi.fn(),
  mockSaveBlockTree: vi.fn(),
  mockGetProperties: vi.fn(),
  mockMoveBlocks: vi.fn(),
}))

vi.mock('../wasm/client', () => ({
  initCoreClient: mockInitCoreClient,
  getCoreClient: vi.fn(),
  isTauriEnvironment: vi.fn(() => false),
}))

function payload(id: string, content: string, children: BlockClipPayload[] = []): BlockClipPayload {
  return { id, content, type: 'text', format: null, properties: null, children }
}

describe('pasteBlocksWithOp — 剪切载荷的搬移分支', () => {
  let useBlockStore: typeof import('./blocks').useBlockStore

  beforeEach(async () => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()

    const mockClient = {
      saveBlockTree: mockSaveBlockTree,
      setFieldValue: vi.fn(),
      getFieldValues: mockGetProperties,
      getPageWithBlocks: vi.fn().mockResolvedValue(null),
      // 搬移后「读回被搬的块」：库里它们已经在 B 页了（store 里此时查不到）
      getBlocksByPage: vi.fn().mockResolvedValue([
        {
          id: 'src', page_id: 'B', parent_id: null, pos: 1500, content: '源块',
          format: '{}', type: 'query', tags: [], created_at: 1, updated_at: 1,
        },
        {
          id: 'src-child', page_id: 'B', parent_id: 'src', pos: 1000, content: '子块',
          format: '{}', type: 'text', tags: [], created_at: 1, updated_at: 1,
        },
      ]),
      getPage: vi.fn(),
      moveBlocks: mockMoveBlocks,
    }
    mockSaveBlockTree.mockImplementation(async (updates: Array<{ id: string; content: string }>) => [
      { id: updates[0].id, block: { id: updates[0].id, content: updates[0].content }, render_segments: [] },
    ])
    mockGetProperties.mockResolvedValue([])
    mockInitCoreClient.mockResolvedValue(mockClient)

    useBlockStore = (await import('./blocks')).useBlockStore
  })

  function seedTwoPages() {
    const store = useBlockStore()
    store.blocks = [
      {
        id: 'src', pageId: 'A', parentId: null, pos: 1000, content: '源块',
        format: {}, type: 'query', createdAt: 1, updatedAt: 1,
      },
      {
        id: 'anchor', pageId: 'B', parentId: null, pos: 1000, content: '锚点',
        format: {}, type: 'text', createdAt: 1, updatedAt: 1,
      },
      {
        id: 'src-child', pageId: 'A', parentId: 'src', pos: 1000, content: '子块',
        format: {}, type: 'text', createdAt: 1, updatedAt: 1,
      },
    ]
    return store
  }

  test('搬移成功：id 不变、根与后代一起换页、回传源页供撤销配对', async () => {
    const store = seedTwoPages()
    mockMoveBlocks.mockResolvedValue(undefined)

    const outcome = await store.pasteBlocksWithOp(
      // 真实载荷带完整子树（serializeBlocks 递归），后代 id 由此进入搬移集合
      [payload('src', '源块', [payload('src-child', '子块')])],
      {
        pageId: 'B',
        anchorBlockId: 'anchor',
        fallbackParentId: null,
      },
      'cut',
    )

    expect(outcome.moved).toBe(true)
    expect(outcome.movedFromPageId).toBe('A')
    // 交给 Rust 的目标：同一个 id、目标页、锚点同级、落在锚点之后
    expect(mockMoveBlocks).toHaveBeenCalledTimes(1)
    const targets = mockMoveBlocks.mock.calls[0][0]
    expect(targets).toHaveLength(1)
    expect(targets[0]).toMatchObject({ blockId: 'src', pageId: 'B', parentId: null })
    expect(targets[0].pos).toBeGreaterThan(1000)

    // 内存回写：根与**后代**都换页（后代没回写 ⇒ 源页仍在渲染它 = 同 id 两页并存）
    expect(store.getBlock('src')?.pageId).toBe('B')
    expect(store.getBlock('src-child')?.pageId).toBe('B')
    expect(store.getBlock('src')?.pos).toBe(targets[0].pos)
    // 没有新建块
    expect(mockSaveBlockTree).not.toHaveBeenCalled()
  })

  test('搬不动（跨库 / 连粘第二次 / 已被恢复）⇒ 回落新建，且不动内存', async () => {
    const store = seedTwoPages()
    mockMoveBlocks.mockRejectedValue(new Error('Error: BLOCK_MOVE_NOT_REVIVABLE:src'))

    const outcome = await store.pasteBlocksWithOp([payload('src', '源块')], {
      pageId: 'B',
      anchorBlockId: 'anchor',
      fallbackParentId: null,
    }, 'cut')

    expect(outcome.moved).toBe(false)
    expect(outcome.movedFromPageId).toBeNull()
    // 新建路径：新块落在 B，源块仍在 A（这才是「复制」的语义）
    expect(outcome.blocks).toHaveLength(1)
    expect(outcome.blocks[0].id).not.toBe('src')
    expect(outcome.blocks[0].pageId).toBe('B')
    expect(store.getBlock('src')?.pageId).toBe('A')
  })

  test('复制载荷（op=copy）从不尝试搬移', async () => {
    const store = seedTwoPages()

    const outcome = await store.pasteBlocksWithOp([payload('src', '源块')], {
      pageId: 'B',
      anchorBlockId: 'anchor',
      fallbackParentId: null,
    }, 'copy')

    expect(mockMoveBlocks).not.toHaveBeenCalled()
    expect(outcome.moved).toBe(false)
    expect(outcome.blocks[0].id).not.toBe('src')
    expect(store.getBlock('src')?.pageId).toBe('A')
  })

  test('载荷根块缺 id（外部粘贴）⇒ 不尝试搬移', async () => {
    const store = seedTwoPages()

    const outcome = await store.pasteBlocksWithOp(
      [{ content: '外部文本', type: 'text', format: null, properties: null, children: [] }],
      { pageId: 'B', anchorBlockId: 'anchor', fallbackParentId: null },
      'cut',
    )

    expect(mockMoveBlocks).not.toHaveBeenCalled()
    expect(outcome.moved).toBe(false)
    expect(store.getBlock('src')?.pageId).toBe('A')
  })

  /**
   * 真实剪切的现场：`deleteBlocks` 已经把块**从内存里摘掉**了，粘贴那一刻按 id 回查
   * `blocks.value` 必然落空 ⇒ 源页只能来自载荷。这条若退化成「查内存」，跨页搬移的
   * 一步撤销会静默失效（表现为「撤销后块进回收站、没回源页」）。
   */
  test('剪切后块已不在内存：源页取自载荷而不是内存', async () => {
    const store = seedTwoPages()
    // 模拟 deleteBlocks 的乐观剔除
    store.blocks = store.blocks.filter(b => b.pageId !== 'A')
    expect(store.getBlock('src')).toBeUndefined()

    mockMoveBlocks.mockResolvedValue(undefined)
    const outcome = await store.pasteBlocksWithOp(
      [payload('src', '源块', [payload('src-child', '子块')])],
      { pageId: 'B', anchorBlockId: 'anchor', fallbackParentId: null },
      'cut',
      'A',
    )

    expect(outcome.moved).toBe(true)
    expect(outcome.movedFromPageId).toBe('A')
  })
})
