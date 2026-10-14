import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { RenderSegment } from '../wasm/types'

// Mock client（沿用 blocks.gap-renumber.test.ts 的 harness）：
// saveBlockTree 返回空 render_segments，故不会回写覆盖测试构造的裁剪值。
const { mockInitCoreClient, mockSaveBlockTree } = vi.hoisted(() => ({
  mockInitCoreClient: vi.fn(),
  mockSaveBlockTree: vi.fn(),
}))

vi.mock('../wasm/client', () => ({
  initCoreClient: mockInitCoreClient,
  getCoreClient: vi.fn(),
  isTauriEnvironment: vi.fn(() => false),
}))

/** content = `ab((part-of))[[D]]cd` 的段划分（encoded 坐标系，覆盖全文无 gap） */
const SEGMENTS: RenderSegment[] = [
  { type: 'text', start: 0, end: 2 },
  {
    type: 'typed_link',
    start: 2,
    end: 18,
    target_page_title: 'D',
    display_text: 'D',
    relationship_type: 'part-of',
    rel_label: '属于',
    rel_color: 'var(--rel-color-1)',
  },
  { type: 'text', start: 18, end: 20 },
]

describe('中部分拆：旧/新块 renderSegments 即时裁剪（闭合裸标记窗口）', () => {
  let useBlockStore: typeof import('./blocks').useBlockStore

  beforeEach(async () => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()

    const mockClient = {
      saveBlockTree: mockSaveBlockTree,
      getPageWithBlocks: vi.fn(),
      getBlocksByPage: vi.fn(),
      getPage: vi.fn(),
    }
    mockSaveBlockTree.mockImplementation(async (updates: { id: string; content: string }[]) => [
      {
        id: updates[0].id,
        block: { id: updates[0].id, content: updates[0].content },
        render_segments: [],
      },
    ])
    mockInitCoreClient.mockResolvedValue(mockClient)

    useBlockStore = (await import('./blocks')).useBlockStore
  })

  async function makeBlock(store: ReturnType<typeof useBlockStore>, pageId: string) {
    const block = await store.createBlock({ pageId, content: 'ab((part-of))[[D]]cd' })
    block.renderSegments = SEGMENTS.map(s => ({ ...s })) as RenderSegment[]
    return block
  }

  test('切点落在 typed_link 段内部 → 对齐到段末尾，旧块段保持完整（不被截成残缺标记）', async () => {
    const store = useBlockStore()
    const block = await makeBlock(store, 'p-split-1')

    // cursorPos 5 → encoded offset 4，正落在 typed_link(2,18) 内部
    const newBlock = await store.insertBlockAtCursor(block.id, 5, false)

    expect(store.getBlock(block.id)!.content).toBe('ab((part-of))[[D]]')  // 对齐后切在段末尾
    expect(store.getBlock(block.id)!.renderSegments).toEqual([
      { type: 'text', start: 0, end: 2 },
      { type: 'typed_link', start: 2, end: 18, target_page_title: 'D', display_text: 'D', relationship_type: 'part-of', rel_label: '属于', rel_color: 'var(--rel-color-1)' },
    ])

    expect(newBlock).not.toBeNull()
    expect(newBlock!.content).toBe('cd')
    expect(newBlock!.renderSegments).toEqual([{ type: 'text', start: 0, end: 2 }])
  })

  test('切点落在 text 段内部 → 旧块尾部 text 段截断，新块段整体平移', async () => {
    const store = useBlockStore()
    const block = await makeBlock(store, 'p-split-2')

    // cursorPos 2 → encoded offset 1，落在 text(0,2) 内部（text 段不对齐）
    const newBlock = await store.insertBlockAtCursor(block.id, 2, false)

    expect(store.getBlock(block.id)!.content).toBe('a')
    expect(store.getBlock(block.id)!.renderSegments).toEqual([{ type: 'text', start: 0, end: 1 }])

    expect(newBlock).not.toBeNull()
    expect(newBlock!.content).toBe('b((part-of))[[D]]cd')
    expect(newBlock!.renderSegments).toEqual([
      { type: 'text', start: 0, end: 1 },
      { type: 'typed_link', start: 1, end: 17, target_page_title: 'D', display_text: 'D', relationship_type: 'part-of', rel_label: '属于', rel_color: 'var(--rel-color-1)' },
      { type: 'text', start: 17, end: 19 },
    ])
  })

  test('退化块（无 renderSegments）→ 中部分拆后仍为 undefined（回退行为不变，不凭空造段）', async () => {
    const store = useBlockStore()
    const block = await store.createBlock({ pageId: 'p-split-3', content: 'ab((part-of))[[D]]cd' })
    // 不赋 renderSegments —— 模拟 Rust 快照缺失的块

    const newBlock = await store.insertBlockAtCursor(block.id, 5, false)

    expect(newBlock).not.toBeNull()
    expect(store.getBlock(block.id)!.renderSegments).toBeUndefined()
    expect(newBlock!.renderSegments).toBeUndefined()
  })
})
