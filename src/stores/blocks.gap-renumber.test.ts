import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { GAP_SIZE } from '../utils/block-helpers'
import type { Block } from '../types/block'

// Mock client 方法（沿用 blocks.render-segments.test.ts 的 harness）
const {
  mockInitCoreClient,
  mockSaveBlockTree,
} = vi.hoisted(() => ({
  mockInitCoreClient: vi.fn(),
  mockSaveBlockTree: vi.fn(),
}))

vi.mock('../wasm/client', () => ({
  initCoreClient: mockInitCoreClient,
  getCoreClient: vi.fn(),
  isTauriEnvironment: vi.fn(() => false),
}))

describe('gap 耗尽 → 重编号恢复：插入点必须仍落在原锚点旁边', () => {
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

  /** 同级兄弟按 pos 升序 */
  const siblingsOf = (store: ReturnType<typeof useBlockStore>, pageId: string) =>
    store.blocks
      .filter((b: Block) => b.pageId === pageId && b.parentId === null)
      .sort((a: Block, b: Block) => a.pos - b.pos)

  test('行尾连续 Enter 触发 gap 耗尽后，新块仍紧邻锚点（不跳到块栈中部）', async () => {
    const store = useBlockStore()
    const pageId = 'page-gap-end'
    const a = await store.createBlock({ pageId, content: 'a', pos: GAP_SIZE })
    const b = await store.createBlock({ pageId, content: 'b', pos: GAP_SIZE * 2 })

    let ref = a
    const trace: string[] = []

    // 连续 Enter（每次在刚建出的块行尾），足以触发 gap 耗尽 + 重编号恢复
    for (let i = 0; i < 14; i++) {
      const next = await store.insertBlockAtCursor(ref.id, ref.content.length + 1, false)
      expect(next, `第 ${i + 1} 次 Enter 未产出新块`).not.toBeNull()

      const siblings = siblingsOf(store, pageId)
      const refIdx = siblings.findIndex(s => s.id === ref.id)
      const newIdx = siblings.findIndex(s => s.id === next!.id)
      trace.push(`#${i + 1} ref.pos=${ref.pos} new.pos=${next!.pos} 落点=${newIdx} 期望=${refIdx + 1}`)

      // 不变式：新块必须紧跟在锚点之后，且 pos 大于锚点
      expect(newIdx, `第 ${i + 1} 次 Enter 落点错位\n${trace.join('\n')}`).toBe(refIdx + 1)
      expect(next!.pos).toBeGreaterThan(ref.pos)

      ref = next!
    }

    const finalSiblings = siblingsOf(store, pageId)
    expect(finalSiblings[finalSiblings.length - 1].id).toBe(b.id)
  })

  test('行首连续 Enter（insertSiblingAbove 路径）gap 耗尽后仍插在锚点上方', async () => {
    const store = useBlockStore()
    const pageId = 'page-gap-start'
    const a = await store.createBlock({ pageId, content: 'a', pos: GAP_SIZE })
    const b = await store.createBlock({ pageId, content: 'b', pos: GAP_SIZE * 2 })

    const trace: string[] = []
    for (let i = 0; i < 14; i++) {
      const next = await store.insertBlockAtCursor(b.id, 1, false)
      expect(next, `第 ${i + 1} 次 Enter 未产出新块`).not.toBeNull()

      const siblings = siblingsOf(store, pageId)
      const bIdx = siblings.findIndex(s => s.id === b.id)
      const newIdx = siblings.findIndex(s => s.id === next!.id)
      trace.push(`#${i + 1} new.pos=${next!.pos} 落点=${newIdx} 期望=${bIdx - 1}`)

      expect(newIdx, `第 ${i + 1} 次行首 Enter 落点错位\n${trace.join('\n')}`).toBe(bIdx - 1)
      expect(next!.pos).toBeLessThan(b.pos)
    }

    const finalSiblings = siblingsOf(store, pageId)
    expect(finalSiblings[0].id).toBe(a.id)
    expect(finalSiblings[finalSiblings.length - 1].id).toBe(b.id)
  })
})
