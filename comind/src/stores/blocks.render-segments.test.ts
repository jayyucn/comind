import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Mock client 方法
const {
  mockInitCoreClient,
  mockSaveBlockTree,
  mockGetPageWithBlocks,
  mockGetBlocksByPage,
  mockGetPage,
} = vi.hoisted(() => ({
  mockInitCoreClient: vi.fn(),
  mockSaveBlockTree: vi.fn(),
  mockGetPageWithBlocks: vi.fn(),
  mockGetBlocksByPage: vi.fn(),
  mockGetPage: vi.fn(),
}))

// 注意：路径相对于 __tests__ 目录中的测试文件位置
// 文件在 src/stores/blocks.render-segments.test.ts
// 被 mock 模块 initCoreClient 在 src/wasm/client.ts 中被 blocks.ts 使用
// 使用 '../wasm/client' 从 src/stores/ 解析到 src/wasm/
vi.mock('../wasm/client', () => ({
  initCoreClient: mockInitCoreClient,
  getCoreClient: vi.fn(),
}))

function makeSaveResult(blockId: string, content: string, renderSegments: any[] = []) {
  return {
    id: blockId,
    block: { id: blockId, content } as any,
    render_segments: renderSegments,
    snapshot: null,
  }
}

function makePageWithBlocks(pageId: string, blocks: any[] = []) {
  return {
    page: { id: pageId } as any,
    blocks,
  }
}

describe('flushSave / _doSave renderSegments 恢复（mock WASM）', () => {
  let useBlockStore: typeof import('./blocks').useBlockStore

  beforeEach(async () => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()

    const mockClient = {
      saveBlockTree: mockSaveBlockTree,
      getPageWithBlocks: mockGetPageWithBlocks,
      getBlocksByPage: mockGetBlocksByPage,
      getPage: mockGetPage,
    }

    mockSaveBlockTree.mockImplementation(async (updates: any[]) => {
      // saveBlockTree 返回数组，代码用 const [saveResult] 解构第一个元素
      return [makeSaveResult(updates[0].id, updates[0].content, [
        { type: 'text', start: 0, end: updates[0].content.length },
      ])]
    })

    mockInitCoreClient.mockResolvedValue(mockClient)

    useBlockStore = (await import('./blocks')).useBlockStore
  })

  test('flushSave 取消防抖并立即执行 _doSave，renderSegments 从 saveResult 恢复', async () => {
    const store = useBlockStore()
    const pageId = 'page-flush-1'

    const block = await store.createBlock({ pageId, content: '初始' })

    // updateBlockContent 触发防抖保存
    store.updateBlockContent(block.id, '新内容 [[目标页]]')

    // renderSegments 立即被清空
    expect(store.getBlock(block.id)?.renderSegments).toBeUndefined()

    // flushSave 立即执行（不需要等防抖窗口）
    await store.flushSave(block.id)

    // renderSegments 被恢复
    const saved = store.getBlock(block.id)
    expect(saved?.renderSegments).toBeDefined()
    expect(saved?.renderSegments!.length).toBeGreaterThan(0)
  })

  test('_doSave 竞态保护：content 改变后新 segments 覆盖旧结果', async () => {
    const store = useBlockStore()
    const pageId = 'page-race-1'

    const block = await store.createBlock({ pageId, content: 'Version 1' })

    // 第一次编辑
    store.updateBlockContent(block.id, 'Version 1')

    // 在 save 完成前第二次编辑
    store.updateBlockContent(block.id, 'Version 2')

    // flushSave 保存最新 content
    await store.flushSave(block.id)

    const saved = store.getBlock(block.id)
    expect(saved?.content).toBe('Version 2')
    expect(saved?.renderSegments).toBeDefined()
  })

  test('saveResult 中无 render_segments 时保持 undefined', async () => {
    const store = useBlockStore()
    const pageId = 'page-no-segs-1'

    // 覆盖 mock 返回空 render_segments
    mockSaveBlockTree.mockImplementation(async (updates: any[]) => {
      return [makeSaveResult(updates[0].id, updates[0].content, [])]
    })

    const block = await store.createBlock({ pageId, content: '纯文本' })

    store.updateBlockContent(block.id, '纯文本')
    await store.flushSave(block.id)

    const saved = store.getBlock(block.id)
    expect(saved?.content).toBe('纯文本')
    expect(saved?.renderSegments).toBeUndefined()
  })

  test('flushSave 无 pending save 时直接返回不报错', async () => {
    const store = useBlockStore()
    const pageId = 'page-flush-2'

    const block = await store.createBlock({ pageId, content: 'Plain' })

    // flushSave 应直接返回（block 存在但无 pending）
    await expect(store.flushSave(block.id)).resolves.not.toThrow()
    expect(store.getBlock(block.id)?.content).toBe('Plain')
  })
})

describe('loadPageBlocks（mock WASM）', () => {
  let useBlockStore: typeof import('./blocks').useBlockStore

  beforeEach(async () => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()

    const mockClient = {
      saveBlockTree: mockSaveBlockTree,
      getPageWithBlocks: mockGetPageWithBlocks,
      getBlocksByPage: mockGetBlocksByPage,
      getPage: mockGetPage,
    }

    mockSaveBlockTree.mockResolvedValue([])
    mockGetPageWithBlocks.mockResolvedValue({ page: { id: 'p1' }, blocks: [] })
    mockGetBlocksByPage.mockResolvedValue([])

    mockInitCoreClient.mockResolvedValue(mockClient)

    useBlockStore = (await import('./blocks')).useBlockStore
  })

  test('getPageWithBlocks 成功时使用 pw.blocks 作为数据源', async () => {
    const store = useBlockStore()
    const pageId = 'page-load-1'

    mockGetPageWithBlocks.mockResolvedValue(makePageWithBlocks(pageId, [
      {
        block: { id: 'b1', page_id: pageId, parent_id: null, pos: 100, content: 'Block A', format: '{}', type: 'bullet', created_at: 0, updated_at: 0 },
        children: [],
        render_segments: [{ type: 'text', start: 0, end: 8 }],
        properties: [],
      },
      {
        block: { id: 'b2', page_id: pageId, parent_id: null, pos: 200, content: 'Block B', format: '{}', type: 'bullet', created_at: 0, updated_at: 0 },
        children: [],
        render_segments: [],
        properties: [],
      },
    ]))

    const blocks = await store.loadPageBlocks(pageId)
    expect(blocks.value.length).toBe(2)
    expect(blocks.value[0].renderSegments).toBeDefined()
    expect(blocks.value[1].renderSegments).toEqual([])
  })

  test('getPageWithBlocks 失败时回退到 getBlocksByPage', async () => {
    const store = useBlockStore()
    const pageId = 'page-fallback-1'

    mockGetPageWithBlocks.mockRejectedValue(new Error('RPC unavailable'))
    mockGetBlocksByPage.mockResolvedValue([
      { id: 'b1', page_id: pageId, parent_id: null, pos: 100, content: 'Fallback Block', format: '{}', type: 'bullet', created_at: 0, updated_at: 0 },
    ])

    const blocks = await store.loadPageBlocks(pageId)
    expect(blocks.value.length).toBe(1)
    // 回退路径 renderSegments 为 undefined
    expect(blocks.value[0].renderSegments).toBeUndefined()
  })

  test('loadPageBlocks 返回空列表', async () => {
    const store = useBlockStore()
    const pageId = 'page-empty-1'

    mockGetPageWithBlocks.mockResolvedValue(makePageWithBlocks(pageId, []))

    const blocks = await store.loadPageBlocks(pageId)
    expect(blocks.value.length).toBe(0)
  })
})
