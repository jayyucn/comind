// 写笔记业务单测（票 06 / ADR-0040 D3/D4/D7）：高亮 → 书 Page 下 append
// bullet Block（属性四件套 book/chapter/cfi/quote）→ 回填高亮行 block_id →
// emitTo 主窗口 'reader:data-changed'。更新路径：已有 block_id 的高亮再写 →
// 只更新同一条 Block 的 content，不新建 Block/属性，也不重复回填。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { BookHighlightRust } from '../wasm/types'

// 跨窗口事件 API mock（Tauri 2 event）
const { mockEmitTo } = vi.hoisted(() => ({ mockEmitTo: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ emitTo: mockEmitTo }))

// blocks/property store 依赖的 client mock（内存态即可，验证写路径调用形态）
const { mockClient, mockIsTauri } = vi.hoisted(() => {
  const client = {
    getPageWithBlocks: vi.fn(),
    getBlocksByPage: vi.fn(),
    saveBlockTree: vi.fn(),
    setProperty: vi.fn(),
    getProperties: vi.fn(),
    getBlock: vi.fn(),
    upsertBookHighlight: vi.fn(),
    triggerSync: vi.fn(),
  }
  return { mockClient: client, mockIsTauri: vi.fn() }
})
vi.mock('../wasm/client', () => ({
  initCoreClient: async () => mockClient,
  isTauriEnvironment: () => mockIsTauri(),
  triggerSync: mockClient.triggerSync,
}))

// _doSave 动态 import 的通知服务（阅读器窗口无通知调度，mock 掉副作用）
vi.mock('./notification-service', () => ({
  getNotificationService: vi.fn(async () => ({ syncPayloadForBlock: vi.fn() })),
}))

import { createOrUpdateNoteBlock, loadNoteText } from './book-note'

/** 高亮记录构造（Rust 侧 upsert 全量字段） */
function makeHighlight(blockId: string | null = null): BookHighlightRust {
  return {
    id: 'hl-1',
    book_page_id: 'book-1',
    cfi: 'epubcfi(/6/2!/4/2:0)',
    text: '原文摘录',
    chapter: '第一章',
    color: 'yellow',
    block_id: blockId,
    created_at: 100,
    updated_at: 100,
  }
}

/** saveBlockTree 回显：Rust 返回 [{ block: <rust 命名 block>, render_segments, snapshot }] */
function echoSaveBlockTree(list: Array<Record<string, unknown>>) {
  mockClient.saveBlockTree.mockImplementation(async (updates: Array<Record<string, unknown>>) =>
    updates.map(u => ({
      block: { ...u, created_at: u.created_at ?? 1 },
      render_segments: [],
      snapshot: null,
    })))
  return list
}

/** setProperty 回显：Rust 返回属性行 */
function echoSetProperty() {
  mockClient.setProperty.mockImplementation(
    async (blockId: string, key: string, value: string, type: string) => ({
      id: `prop-${key}`,
      block_id: blockId,
      key,
      value,
      type,
      sort_order: 0,
      is_hidden: 0,
      is_deleted: 0,
      schema_version: 1,
      created_at: 1,
      updated_at: 1,
    }))
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  mockIsTauri.mockReturnValue(false)
  mockClient.getPageWithBlocks.mockResolvedValue({ blocks: [] })
  mockClient.getBlocksByPage.mockResolvedValue([])
  mockClient.getProperties.mockResolvedValue([])
  mockClient.upsertBookHighlight.mockImplementation(async (h: BookHighlightRust) => h)
  echoSetProperty()
})

describe('createOrUpdateNoteBlock（新建笔记）', () => {
  it('书 Page 根级 append bullet Block：parent_id=null、type=bullet、content=想法文本', async () => {
    echoSaveBlockTree([])

    const result = await createOrUpdateNoteBlock({
      bookPageId: 'book-1',
      bookTitle: '测试书',
      chapter: '第一章',
      cfi: 'epubcfi(/6/2!/4/2:0)',
      quote: '原文摘录',
      text: '我的想法',
      highlight: makeHighlight(),
    })

    expect(result.created).toBe(true)
    // 写入前先加载该书 Page 现有 blocks（末尾 append 的 pos 基准）
    expect(mockClient.getPageWithBlocks).toHaveBeenCalledWith('book-1')
    // block 落库（flushSave 立即持久化）
    expect(mockClient.saveBlockTree).toHaveBeenCalledTimes(1)
    const saved = mockClient.saveBlockTree.mock.calls[0][0][0]
    expect(saved.id).toBe(result.blockId)
    expect(saved.page_id).toBe('book-1')
    expect(saved.parent_id).toBeNull()
    expect(saved.type).toBe('bullet')
    expect(saved.content).toBe('我的想法')
  })

  it('已有 blocks 时 append 到末尾（pos 大于现有最后一个根级 block）', async () => {
    mockClient.getPageWithBlocks.mockResolvedValue({
      blocks: [{
        block: {
          id: 'exist-1', page_id: 'book-1', parent_id: null, pos: 1000,
          content: '已有笔记', format: '{}', type: 'bullet', created_at: 0, updated_at: 0,
        },
        children: [],
        render_segments: [],
        properties: {},
      }],
    })
    echoSaveBlockTree([])

    await createOrUpdateNoteBlock({
      bookPageId: 'book-1',
      bookTitle: '测试书',
      chapter: '第一章',
      cfi: 'epubcfi(/6/2!/4/2:0)',
      quote: '原文摘录',
      text: '第二条想法',
      highlight: makeHighlight(),
    })

    const saved = mockClient.saveBlockTree.mock.calls[0][0][0]
    expect(saved.pos).toBeGreaterThan(1000)
  })

  it('属性四件套 book/chapter/cfi/quote 逐一写入（type=string）', async () => {
    echoSaveBlockTree([])

    const result = await createOrUpdateNoteBlock({
      bookPageId: 'book-1',
      bookTitle: '测试书',
      chapter: '第一章',
      cfi: 'epubcfi(/6/2!/4/2:0)',
      quote: '原文摘录',
      text: '我的想法',
      highlight: makeHighlight(),
    })

    const propCalls = mockClient.setProperty.mock.calls.map(
      (c: unknown[]) => [c[1], c[2], c[3]] as const,
    )
    expect(propCalls).toContainEqual(['book', '测试书', 'string'])
    expect(propCalls).toContainEqual(['chapter', '第一章', 'string'])
    expect(propCalls).toContainEqual(['cfi', 'epubcfi(/6/2!/4/2:0)', 'string'])
    expect(propCalls).toContainEqual(['quote', '原文摘录', 'string'])
    // 四件套都挂在新建 block 上
    for (const c of mockClient.setProperty.mock.calls) {
      expect(c[0]).toBe(result.blockId)
    }
  })

  it('回填高亮行 block_id：upsert 全量带原 id（ON CONFLICT 更新，不新建高亮行）', async () => {
    echoSaveBlockTree([])

    const result = await createOrUpdateNoteBlock({
      bookPageId: 'book-1',
      bookTitle: '测试书',
      chapter: '第一章',
      cfi: 'epubcfi(/6/2!/4/2:0)',
      quote: '原文摘录',
      text: '我的想法',
      highlight: makeHighlight(),
    })

    expect(mockClient.upsertBookHighlight).toHaveBeenCalledTimes(1)
    const upserted = mockClient.upsertBookHighlight.mock.calls[0][0] as BookHighlightRust
    expect(upserted.id).toBe('hl-1')
    expect(upserted.block_id).toBe(result.blockId)
    expect(result.highlight.block_id).toBe(result.blockId)
  })

  it('Tauri 环境写入成功后 emitTo 主窗口 reader:data-changed（含 pageId）', async () => {
    mockIsTauri.mockReturnValue(true)
    echoSaveBlockTree([])

    await createOrUpdateNoteBlock({
      bookPageId: 'book-1',
      bookTitle: '测试书',
      chapter: '第一章',
      cfi: 'epubcfi(/6/2!/4/2:0)',
      quote: '原文摘录',
      text: '我的想法',
      highlight: makeHighlight(),
    })

    expect(mockEmitTo).toHaveBeenCalledTimes(1)
    expect(mockEmitTo).toHaveBeenCalledWith('main', 'reader:data-changed', { pageId: 'book-1' })
  })

  it('非 Tauri 环境不 emit（web/Android 无跨窗口事件系统）', async () => {
    echoSaveBlockTree([])

    await createOrUpdateNoteBlock({
      bookPageId: 'book-1',
      bookTitle: '测试书',
      chapter: '第一章',
      cfi: 'epubcfi(/6/2!/4/2:0)',
      quote: '原文摘录',
      text: '我的想法',
      highlight: makeHighlight(),
    })

    expect(mockEmitTo).not.toHaveBeenCalled()
  })

  it('emit 失败不影响写入结果（跨窗口通知是尽力而为）', async () => {
    mockIsTauri.mockReturnValue(true)
    mockEmitTo.mockRejectedValue(new Error('no event system'))
    echoSaveBlockTree([])

    const result = await createOrUpdateNoteBlock({
      bookPageId: 'book-1',
      bookTitle: '测试书',
      chapter: '第一章',
      cfi: 'epubcfi(/6/2!/4/2:0)',
      quote: '原文摘录',
      text: '我的想法',
      highlight: makeHighlight(),
    })

    expect(result.created).toBe(true)
    expect(result.blockId).toBeTruthy()
  })
})

describe('createOrUpdateNoteBlock（更新已有笔记）', () => {
  it('已有 block_id 的高亮再写：只更新该 Block 的 content，不新建 Block/属性/回填', async () => {
    echoSaveBlockTree([])
    mockClient.getBlock.mockResolvedValue({
      id: 'b-1', page_id: 'book-1', parent_id: null, pos: 1000,
      content: '旧想法', format: '{}', type: 'bullet', created_at: 1, updated_at: 1,
    })

    const result = await createOrUpdateNoteBlock({
      bookPageId: 'book-1',
      bookTitle: '测试书',
      chapter: '第一章',
      cfi: 'epubcfi(/6/2!/4/2:0)',
      quote: '原文摘录',
      text: '新想法',
      highlight: makeHighlight('b-1'),
    })

    expect(result.created).toBe(false)
    expect(result.blockId).toBe('b-1')
    // 先从库加载该 block（阅读器窗口内存无此 block）
    expect(mockClient.getBlock).toHaveBeenCalledWith('b-1')
    // 只有一次 save（更新 b-1 的 content），无新建
    expect(mockClient.saveBlockTree).toHaveBeenCalledTimes(1)
    const saved = mockClient.saveBlockTree.mock.calls[0][0][0]
    expect(saved.id).toBe('b-1')
    expect(saved.content).toBe('新想法')
    // 属性不重写、block_id 不重复回填
    expect(mockClient.setProperty).not.toHaveBeenCalled()
    expect(mockClient.upsertBookHighlight).not.toHaveBeenCalled()
  })

  it('更新后同样通知主窗口刷新', async () => {
    mockIsTauri.mockReturnValue(true)
    echoSaveBlockTree([])
    mockClient.getBlock.mockResolvedValue({
      id: 'b-1', page_id: 'book-1', parent_id: null, pos: 1000,
      content: '旧想法', format: '{}', type: 'bullet', created_at: 1, updated_at: 1,
    })

    await createOrUpdateNoteBlock({
      bookPageId: 'book-1',
      bookTitle: '测试书',
      chapter: '第一章',
      cfi: 'epubcfi(/6/2!/4/2:0)',
      quote: '原文摘录',
      text: '新想法',
      highlight: makeHighlight('b-1'),
    })

    expect(mockEmitTo).toHaveBeenCalledWith('main', 'reader:data-changed', { pageId: 'book-1' })
  })
})

describe('loadNoteText', () => {
  it('读取已有笔记 Block 的当前文本（输入浮层预填）', async () => {
    mockClient.getBlock.mockResolvedValue({
      id: 'b-1', page_id: 'book-1', parent_id: null, pos: 1000,
      content: '旧想法', format: '{}', type: 'bullet', created_at: 1, updated_at: 1,
    })

    await expect(loadNoteText('b-1')).resolves.toBe('旧想法')
  })

  it('block 不存在（异常数据）返回空串', async () => {
    mockClient.getBlock.mockResolvedValue(null as never)

    await expect(loadNoteText('missing')).resolves.toBe('')
  })
})
