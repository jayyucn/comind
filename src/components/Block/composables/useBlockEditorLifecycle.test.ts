import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'
import { useBlockEditorLifecycle } from './useBlockEditorLifecycle'
import { useBlockStore } from '../../../stores/blocks'
import { useEditorStore } from '../../../stores/editor'
import { usePageStore } from '../../../stores/pages'
import { useBlockRelationshipCleanup } from '../../../composables/useBlockRelationshipCleanup'
import type { BlockTypeEditorExposed } from '../../../types/block-type'

// useNavigateToPage 依赖 useRouter，单元测试中需 mock
// 使用 vi.hoisted 暴露 navigateToPage mock，供 handleContentClick 测试断言
const { navigateToPageMock } = vi.hoisted(() => ({
  navigateToPageMock: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../../../composables/useNavigateToPage', () => ({
  useNavigateToPage: () => ({
    navigateToPage: navigateToPageMock
  })
}))

// ADR-0050 D7：inline `#tag` chip 点击走独立的标签导航工具（同样依赖 useRouter）
const { navigateToTagMock } = vi.hoisted(() => ({
  navigateToTagMock: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../../../composables/useNavigateToTag', () => ({
  useNavigateToTag: () => ({
    navigateToTag: navigateToTagMock,
    navigateToTagLibrary: vi.fn().mockResolvedValue(undefined)
  })
}))

// useRelationshipMenu 内部依赖 useRelationshipTypes，mock 掉以隔离
// 暴露 relMenuMock 供 handleContentClick rel-type-label 测试断言
const { relMenuMock } = vi.hoisted(() => ({
  relMenuMock: {
    openSwitch: vi.fn(),
    open: vi.fn(),
    close: vi.fn(),
  }
}))

vi.mock('../../../composables/useRelationshipMenu', () => ({
  useRelationshipMenu: () => relMenuMock
}))

// useDateRefClickListener 内部调用 onMounted/onBeforeUnmount；
// 单元测试不在组件 setup 中运行，mock 掉以避免 Vue 警告。
// useDateTimePickerPanel 的 open 也换为 spy —— 渲染态 date-ref 点击断言它收到的
// from/to（真实 open 会去写 editorStore.dateRefEditor，与断言无关）。
const { openDateRefPanelMock } = vi.hoisted(() => ({
  openDateRefPanelMock: vi.fn()
}))

vi.mock('../../../composables/useDateTimePickerPanel', async () => {
  const actual = await vi.importActual<typeof import('../../../composables/useDateTimePickerPanel')>(
    '../../../composables/useDateTimePickerPanel'
  )
  return {
    ...actual,
    useDateRefClickListener: vi.fn(),
    useDateTimePickerPanel: () => ({ ...actual.useDateTimePickerPanel(), open: openDateRefPanelMock }),
  }
})

// 中间拆分的 decoded→encoded 偏移换算必须走 render-text.ts 单一 seam。单测环境里关系类型
// 注册表为空（label 回退成 type、可见长度恰等于存储长度），真实换算退化为恒等 —— 无法用
// 真实值区分「走了 seam」与「直通 decodedOffset」。故把 seam 换成可断言的转发桩：
// 默认转发真实实现（不改变其它用例语义），中间拆分用例里再覆写返回值以钉住路由与参数接线。
const { renderedOffsetSpy, actualRenderedOffset } = vi.hoisted(() => ({
  renderedOffsetSpy: vi.fn(),
  actualRenderedOffset: { fn: null as null | ((content: string, segments: unknown, offset: number) => number) }
}))

vi.mock('../../../services/render-text', async () => {
  const actual = await vi.importActual<typeof import('../../../services/render-text')>(
    '../../../services/render-text'
  )
  actualRenderedOffset.fn = actual.renderedOffsetToEncodedOffset
  return {
    ...actual,
    renderedOffsetToEncodedOffset: (content: string, segments: unknown, offset: number) =>
      renderedOffsetSpy(content, segments, offset)
  }
})

// selection-geometry 依赖 document.elementFromPoint / caretRangeFromPoint（jsdom 无布局），
// 桩掉它才能断言 handleContentMousedown 是否真的启动了文本选区追踪。
const { blockOffsetFromPointMock, caretBlockOffsetMock } = vi.hoisted(() => ({
  blockOffsetFromPointMock: vi.fn(),
  caretBlockOffsetMock: vi.fn()
}))

vi.mock('../../../services/selection-geometry', () => ({
  blockOffsetFromPoint: blockOffsetFromPointMock,
  caretBlockOffsetFromDomSelection: caretBlockOffsetMock
}))

describe('useBlockEditorLifecycle', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    blockOffsetFromPointMock.mockReset()
    caretBlockOffsetMock.mockReset()
    // 默认转发真实实现：只有显式覆写的用例才改变换算结果
    renderedOffsetSpy.mockImplementation(actualRenderedOffset.fn!)
  })

  function setup(selection?: { startTextTracking: (a: unknown, p: unknown) => void; toggleBlock: () => void }) {
    const blockStore = useBlockStore()
    const editorStore = useEditorStore()
    const pageStore = usePageStore()
    const relationshipCleanup = useBlockRelationshipCleanup()

    blockStore.blocks = [{
      id: 'b1', pageId: 'p1', parentId: null, pos: 0,
      content: 'hello', format: {}, type: 'bullet', createdAt: 0, updatedAt: 0
    }]

    const blockId = ref('b1')
    const editorRef = ref<BlockTypeEditorExposed | null>(null)
    const cursorPos = ref(0)
    const collapsed = ref(false)

    const lifecycle = useBlockEditorLifecycle({
      blockId,
      pageId: 'p1',
      editorRef,
      cursorPos,
      collapsed,
      blockStore,
      editorStore,
      pageStore,
      relationshipCleanup,
      selection: (selection ?? null) as never
    })

    return { lifecycle, blockStore, editorStore, blockId, relationshipCleanup, cursorPos }
  }

  describe('handleSave', () => {
    it('calls blockStore.updateBlockContent（默认 commitTags: true = 提交动作）', async () => {
      const { lifecycle, blockStore } = setup()
      const spy = vi.spyOn(blockStore, 'updateBlockContent').mockResolvedValue(undefined)
      await lifecycle.handleSave('new content')
      expect(spy).toHaveBeenCalledWith('b1', 'new content', { commitTags: true })
      // 编辑器防抖打字保存显式传 false（建签门：#f/#fo 中间态不落标签表）
      await lifecycle.handleSave('typing #f', false)
      expect(spy).toHaveBeenLastCalledWith('b1', 'typing #f', { commitTags: false })
    })
  })

  describe('handleLanguageChange', () => {
    it('calls blockStore.updateBlockFieldValues with language', async () => {
      const { lifecycle, blockStore } = setup()
      const spy = vi.spyOn(blockStore, 'updateBlockFieldValues').mockResolvedValue(undefined)
      await lifecycle.handleLanguageChange('python')
      expect(spy).toHaveBeenCalledWith('b1', { language: 'python' })
    })
  })

  describe('handleDelete', () => {
    it('clears content when no previous block', async () => {
      const { lifecycle, blockStore, editorStore } = setup()
      const updateSpy = vi.spyOn(blockStore, 'updateBlockContent').mockResolvedValue(undefined)
      vi.spyOn(blockStore, 'findPreviousBlockInTreeOrder').mockReturnValue(undefined)
      editorStore.activateBlock('b1')
      await lifecycle.handleDelete()
      expect(updateSpy).toHaveBeenCalledWith('b1', '')
    })

    it('deactivates and activates previous block when one exists', async () => {
      const { lifecycle, blockStore, editorStore, relationshipCleanup } = setup()
      const prevBlock = {
        id: 'prev', pageId: 'p1', parentId: null, pos: 0,
        content: '', format: {}, type: 'bullet', createdAt: 0, updatedAt: 0
      }
      blockStore.blocks.push(prevBlock as any)
      vi.spyOn(blockStore, 'findPreviousVisibleBlock').mockReturnValue(prevBlock as any)
      vi.spyOn(blockStore, 'deleteBlocks').mockResolvedValue(undefined)
      vi.spyOn(relationshipCleanup, 'cleanupAfterDelete').mockResolvedValue({
        modifiedCrossPageBlocks: [],
        orphanedTargets: []
      })
      const deactivateSpy = vi.spyOn(editorStore, 'deactivateBlock').mockImplementation(() => {})
      const activateSpy = vi.spyOn(editorStore, 'activateBlock').mockImplementation(() => {})
      await lifecycle.handleDelete()
      expect(deactivateSpy).toHaveBeenCalled()
      expect(relationshipCleanup.cleanupAfterDelete).toHaveBeenCalled()
      expect(activateSpy).toHaveBeenCalledWith('prev')
    })
  })

  describe('handleSplit', () => {
    it('flushes pending save before splitting so store has encoded content', async () => {
      const { lifecycle, blockStore, editorStore } = setup()
      const deactivateSpy = vi.spyOn(editorStore, 'deactivateBlock').mockImplementation(() => {})
      const flushSpy = vi.spyOn(blockStore, 'flushSave').mockResolvedValue(undefined)
      vi.spyOn(blockStore, 'insertBlockAtCursor').mockResolvedValue({
        id: 'b2', pageId: 'p1', parentId: null, pos: 1,
        content: '', format: {}, type: 'bullet', createdAt: 0, updatedAt: 0
      } as any)
      const activateSpy = vi.spyOn(editorStore, 'activateBlock').mockImplementation(() => {})
      await lifecycle.handleSplit(5)
      expect(flushSpy).toHaveBeenCalledWith('b1')
      expect(deactivateSpy).toHaveBeenCalled()
      // insertBlockAtCursor 签名含子树根标记（ADR-0039）：(id, pos, collapsed, undefined, subtreeRoot)
      expect(blockStore.insertBlockAtCursor).toHaveBeenCalledWith('b1', 5, false, undefined, undefined)
      expect(activateSpy).toHaveBeenCalledWith('b2', 1)
    })

    it('converts decoded cursor offset to encoded offset for typed links with different type/label lengths', async () => {
      const { blockStore, editorStore } = setup()
      vi.spyOn(editorStore, 'deactivateBlock').mockImplementation(() => {})
      vi.spyOn(blockStore, 'flushSave').mockResolvedValue(undefined)
      const insertSpy = vi.spyOn(blockStore, 'insertBlockAtCursor').mockResolvedValue({
        id: 'b2', pageId: 'p1', parentId: null, pos: 1,
        content: '', format: {}, type: 'bullet', createdAt: 0, updatedAt: 0
      } as any)
      vi.spyOn(editorStore, 'activateBlock').mockImplementation(() => {})

      // 模拟 typed link 行尾场景：
      // block.content (encoded) = '((part-of))[[D]]sd'  (18 chars)
      // editor.getText() (decoded) = '((属于))[[D]]sd'     (13 chars)
      // 光标在 decoded 文本的行尾 (decodedOffset=13, pmPos=14)
      // 修复后：行尾时 effectivePos = encodedContent.length + 1 = 19
      // insertBlockAtCursor: textOffset = 18, contentLen = 18, isAtLineEnd = true ✅
      blockStore.blocks = [{
        id: 'b1', pageId: 'p1', parentId: null, pos: 0,
        content: '((part-of))[[D]]sd', format: {}, type: 'bullet', createdAt: 0, updatedAt: 0
      }]
      vi.spyOn(blockStore, 'getBlock').mockReturnValue(blockStore.blocks[0] as any)

      // 设置 editorRef mock
      const editorRef = ref({
        getText: () => '((属于))[[D]]sd',
        markSaved: () => {},
        cancelDebouncedSave: () => {},
      } as any)
      const blockId = ref('b1')
      const cursorPos = ref(0)
      const collapsed = ref(false)
      const relationshipCleanup = useBlockRelationshipCleanup()
      const lifecycle2 = useBlockEditorLifecycle({
        blockId, pageId: 'p1',
        editorRef,
        cursorPos, collapsed,
        blockStore, editorStore, pageStore: usePageStore(),
        relationshipCleanup
      })

      // 光标在 decoded 文本行尾：pmPos = 14 (13 chars + 1)
      await lifecycle2.handleSplit(14)

      // 验证传给 insertBlockAtCursor 的 effectivePos 使 textOffset >= contentLen
      const calledPos = insertSpy.mock.calls[0][1]
      const calledTextOffset = calledPos > 0 ? calledPos - 1 : 0
      const calledContentLen = blockStore.blocks[0].content.length
      expect(calledTextOffset).toBeGreaterThanOrEqual(calledContentLen)
    })

    it('纯行尾拆分（content 不变、renderSegments 有效）不 await 落库（修复 Enter 卡顿）', async () => {
      const { blockStore, editorStore } = setup()
      blockStore.blocks = [{
        id: 'b1', pageId: 'p1', parentId: null, pos: 0,
        content: 'hello', format: {}, type: 'bullet', createdAt: 0, updatedAt: 0,
        renderSegments: [{ start: 0, end: 5, type: 'text', value: 'hello' }]
      }]
      vi.spyOn(blockStore, 'getBlock').mockReturnValue(blockStore.blocks[0] as any)
      const flushSpy = vi.spyOn(blockStore, 'flushSave').mockResolvedValue(undefined)
      vi.spyOn(blockStore, 'insertBlockAtCursor').mockResolvedValue({
        id: 'b2', pageId: 'p1', parentId: null, pos: 1,
        content: '', format: {}, type: 'bullet', createdAt: 0, updatedAt: 0
      } as any)
      vi.spyOn(editorStore, 'deactivateBlock').mockImplementation(() => {})
      vi.spyOn(editorStore, 'activateBlock').mockImplementation(() => {})

      // editorRef.getText() 与 content 一致 → content 不变，不触发 encode 改写
      const editorRef = ref({
        getText: () => 'hello',
        markSaved: () => {},
        cancelDebouncedSave: () => {},
      } as any)
      const blockId = ref('b1')
      const cursorPos = ref(0)
      const collapsed = ref(false)
      const relationshipCleanup = useBlockRelationshipCleanup()
      const lifecycle2 = useBlockEditorLifecycle({
        blockId, pageId: 'p1',
        editorRef, cursorPos, collapsed,
        blockStore, editorStore, pageStore: usePageStore(),
        relationshipCleanup
      })

      // 光标在行尾：pmPos = 6 (5 chars + 1)
      await lifecycle2.handleSplit(6)

      // 核心断言：行尾拆分不再 await WASM 落库，光标可立即落位
      expect(flushSpy).not.toHaveBeenCalled()
      expect(blockStore.insertBlockAtCursor).toHaveBeenCalled()
    })

    it('行首拆分：不发多余落库且 effectivePos=1', async () => {
      const { blockStore, editorStore } = setup()
      blockStore.blocks = [{
        id: 'b1', pageId: 'p1', parentId: null, pos: 0,
        content: 'hello', format: {}, type: 'bullet', createdAt: 0, updatedAt: 0,
        renderSegments: [{ start: 0, end: 5, type: 'text', value: 'hello' }]
      }]
      vi.spyOn(blockStore, 'getBlock').mockReturnValue(blockStore.blocks[0] as any)
      const flushSpy = vi.spyOn(blockStore, 'flushSave').mockResolvedValue(undefined)
      const insertSpy = vi.spyOn(blockStore, 'insertBlockAtCursor').mockResolvedValue({
        id: 'b2', pageId: 'p1', parentId: null, pos: 0,
        content: '', format: {}, type: 'bullet', createdAt: 0, updatedAt: 0
      } as any)
      vi.spyOn(editorStore, 'deactivateBlock').mockImplementation(() => {})
      vi.spyOn(editorStore, 'activateBlock').mockImplementation(() => {})

      const editorRef = ref({
        getText: () => 'hello',
        markSaved: () => {},
        cancelDebouncedSave: () => {},
      } as any)
      const lifecycle2 = useBlockEditorLifecycle({
        blockId: ref('b1'), pageId: 'p1',
        editorRef,
        cursorPos: ref(0), collapsed: ref(false),
        blockStore, editorStore, pageStore: usePageStore(),
        relationshipCleanup: useBlockRelationshipCleanup()
      })

      await lifecycle2.handleSplit(1)  // 行首（decodedOffset = 0）
      expect(flushSpy).not.toHaveBeenCalled()
      expect(insertSpy.mock.calls[0][1]).toBe(1)
    })

    it('新空块（content 空、无 renderSegments）行尾拆分不 await 落库（连按回车热路径）', async () => {
      const { blockStore, editorStore } = setup()
      // Enter 建出的空块：createBlock 不产 renderSegments，且行尾拆分只 _scheduleSave 不 await 落库
      blockStore.blocks = [{
        id: 'b1', pageId: 'p1', parentId: null, pos: 0,
        content: '', format: {}, type: 'bullet', createdAt: 0, updatedAt: 0
      }]
      vi.spyOn(blockStore, 'getBlock').mockReturnValue(blockStore.blocks[0] as any)
      const flushSpy = vi.spyOn(blockStore, 'flushSave').mockResolvedValue(undefined)
      const insertSpy = vi.spyOn(blockStore, 'insertBlockAtCursor').mockResolvedValue({
        id: 'b2', pageId: 'p1', parentId: null, pos: 1,
        content: '', format: {}, type: 'bullet', createdAt: 0, updatedAt: 0
      } as any)
      vi.spyOn(editorStore, 'deactivateBlock').mockImplementation(() => {})
      const activateSpy = vi.spyOn(editorStore, 'activateBlock').mockImplementation(() => {})

      const editorRef = ref({
        getText: () => '',
        markSaved: () => {},
        cancelDebouncedSave: () => {},
      } as any)
      const lifecycle2 = useBlockEditorLifecycle({
        blockId: ref('b1'), pageId: 'p1',
        editorRef,
        cursorPos: ref(0), collapsed: ref(false),
        blockStore, editorStore, pageStore: usePageStore(),
        relationshipCleanup: useBlockRelationshipCleanup()
      })

      await lifecycle2.handleSplit(1)
      // 空白新块没有可回写的 renderSegments —— 不得把真实 WASM 写拉回热路径
      expect(flushSpy).not.toHaveBeenCalled()
      expect(insertSpy).toHaveBeenCalled()
      expect(activateSpy).toHaveBeenCalledWith('b2', 1)
    })

    it('拆分未完成时再次 Enter：不并发重拆原块，两次都兑现（连按不漏、不跳错块）', async () => {
      const { blockStore, editorStore } = setup()
      blockStore.blocks = [{
        id: 'b1', pageId: 'p1', parentId: null, pos: 0,
        content: 'hello', format: {}, type: 'bullet', createdAt: 0, updatedAt: 0,
        renderSegments: [{ start: 0, end: 5, type: 'text', value: 'hello' }]
      }]
      vi.spyOn(blockStore, 'getBlock').mockReturnValue(blockStore.blocks[0] as any)

      // 制造 in-flight 窗口：编辑器文本 ≠ store content ⇒ 同步改写 content ⇒ 清空 segments
      // ⇒ 触发 flush（真实 WASM 落库，可挂起）。此时旧编辑器仍聚焦，第二次 Enter 会在窗口内重入。
      let releaseFlush!: () => void
      const flushGate = new Promise<void>(resolve => { releaseFlush = resolve })
      const flushSpy = vi.spyOn(blockStore, 'flushSave').mockReturnValue(flushGate)

      const newB2 = { id: 'b2', pageId: 'p1', parentId: null, pos: 1, content: '', format: {}, type: 'bullet', createdAt: 0, updatedAt: 0 }
      const newB3 = { id: 'b3', pageId: 'p1', parentId: null, pos: 2, content: '', format: {}, type: 'bullet', createdAt: 0, updatedAt: 0 }
      const insertSpy = vi.spyOn(blockStore, 'insertBlockAtCursor')
        .mockResolvedValueOnce(newB2 as any)
        .mockResolvedValueOnce(newB3 as any)
      const deactivateSpy = vi.spyOn(editorStore, 'deactivateBlock').mockImplementation(() => {})
      const activateSpy = vi.spyOn(editorStore, 'activateBlock').mockImplementation(() => {})

      const editorRef = ref({
        getText: () => 'helloX',
        markSaved: () => {},
        cancelDebouncedSave: () => {},
      } as any)
      const lifecycle2 = useBlockEditorLifecycle({
        blockId: ref('b1'), pageId: 'p1',
        editorRef,
        cursorPos: ref(0), collapsed: ref(false),
        blockStore, editorStore, pageStore: usePageStore(),
        relationshipCleanup: useBlockRelationshipCleanup()
      })

      const p1 = lifecycle2.handleSplit(7)  // 'helloX' 行尾（pmPos = 7），卡在 flush
      const p2 = lifecycle2.handleSplit(7)  // 连按：落在 in-flight 窗口
      releaseFlush()
      await Promise.all([p1, p2])

      expect(flushSpy).toHaveBeenCalledTimes(1)          // 重入不得并发二次落库
      expect(deactivateSpy).toHaveBeenCalledTimes(1)     // 只失活一次
      expect(insertSpy).toHaveBeenCalledTimes(2)         // 两次 Enter 都兑现（不漏）
      expect(insertSpy.mock.calls[0][0]).toBe('b1')      // 第一次拆原块
      expect(insertSpy.mock.calls[1][0]).toBe('b2')      // 第二次拆新建块（而非并发重拆原块）
      expect(activateSpy).toHaveBeenLastCalledWith('b3', 1)  // 光标停在最后一次新建块
    })

    it('中间拆分（纯文本）：decoded 偏移原样换算，且不 await 落库', async () => {
      const { blockStore, editorStore } = setup()
      blockStore.blocks = [{
        id: 'b1', pageId: 'p1', parentId: null, pos: 0,
        content: 'hello', format: {}, type: 'bullet', createdAt: 0, updatedAt: 0,
        renderSegments: [{ start: 0, end: 5, type: 'text', value: 'hello' }]
      }]
      vi.spyOn(blockStore, 'getBlock').mockReturnValue(blockStore.blocks[0] as any)
      const flushSpy = vi.spyOn(blockStore, 'flushSave').mockResolvedValue(undefined)
      const insertSpy = vi.spyOn(blockStore, 'insertBlockAtCursor').mockResolvedValue({
        id: 'b2', pageId: 'p1', parentId: null, pos: 1,
        content: 'lo', format: {}, type: 'bullet', createdAt: 0, updatedAt: 0
      } as any)
      vi.spyOn(editorStore, 'deactivateBlock').mockImplementation(() => {})
      vi.spyOn(editorStore, 'activateBlock').mockImplementation(() => {})

      const editorRef = ref({
        getText: () => 'hello',
        markSaved: () => {},
        cancelDebouncedSave: () => {},
      } as any)
      const lifecycle2 = useBlockEditorLifecycle({
        blockId: ref('b1'), pageId: 'p1',
        editorRef, cursorPos: ref(0), collapsed: ref(false),
        blockStore, editorStore, pageStore: usePageStore(),
        relationshipCleanup: useBlockRelationshipCleanup()
      })

      await lifecycle2.handleSplit(4)  // decodedOffset = 3：既非行首(0)也非行尾(5) ⇒ 走中间分支

      // 纯文本 encoded ≡ decoded ⇒ 换算为恒等（effectivePos = decodedOffset + 1）；
      // 且 store 内容未变 ⇒ segments 未被清 ⇒ 无需落库
      expect(insertSpy.mock.calls[0][1]).toBe(4)
      expect(flushSpy).not.toHaveBeenCalled()
    })

    it('中间拆分（typed link）：偏移经 render-text 单一 seam 吸附换算（非恒等）', async () => {
      const { blockStore, editorStore } = setup()
      const encodedContent = '((part-of))[[D]]sd'  // 18 chars（存储态）
      const segments = [
        { start: 0, end: 16, type: 'typed_link', display_text: 'D', relationship_type: 'part-of' },
        { start: 16, end: 18, type: 'text' },
      ]
      blockStore.blocks = [{
        id: 'b1', pageId: 'p1', parentId: null, pos: 0,
        content: encodedContent, format: {}, type: 'bullet', createdAt: 0, updatedAt: 0,
        renderSegments: segments as any
      }]
      vi.spyOn(blockStore, 'getBlock').mockReturnValue(blockStore.blocks[0] as any)
      const insertSpy = vi.spyOn(blockStore, 'insertBlockAtCursor').mockResolvedValue({
        id: 'b2', pageId: 'p1', parentId: null, pos: 1,
        content: '', format: {}, type: 'bullet', createdAt: 0, updatedAt: 0
      } as any)
      vi.spyOn(editorStore, 'deactivateBlock').mockImplementation(() => {})
      vi.spyOn(editorStore, 'activateBlock').mockImplementation(() => {})
      vi.spyOn(blockStore, 'flushSave').mockResolvedValue(undefined)

      // 让编辑器文本与 store 内容一致（往返编码后不变），把断言聚焦在「中间分支的换算」本身
      const editorRef = ref({
        getText: () => encodedContent,
        markSaved: () => {},
        cancelDebouncedSave: () => {},
      } as any)
      const lifecycle2 = useBlockEditorLifecycle({
        blockId: ref('b1'), pageId: 'p1',
        editorRef, cursorPos: ref(0), collapsed: ref(false),
        blockStore, editorStore, pageStore: usePageStore(),
        relationshipCleanup: useBlockRelationshipCleanup()
      })

      const decodedOffset = 8              // 落在 typed_link 的可见文本内（非行首/行尾）
      const SEAM_RESULT = 16               // 桩返回值：encoded 偏移（真实实现会吸附到标记边界）
      renderedOffsetSpy.mockReturnValue(SEAM_RESULT)

      await lifecycle2.handleSplit(decodedOffset + 1)

      // 中间分支必须把 (encoded content, 该块的 renderSegments, decoded 偏移) 交给 seam，
      // 并以返回值 + 1 作为 effectivePos —— 直通 decodedOffset 或漏传 segments 都会被钉住
      expect(renderedOffsetSpy).toHaveBeenCalledTimes(1)
      expect(renderedOffsetSpy).toHaveBeenCalledWith(encodedContent, segments, decodedOffset)
      expect(insertSpy.mock.calls[0][1]).toBe(SEAM_RESULT + 1)
    })

    it('拆分未兑现（未产出新块）不遗留悬挂计次：下一次 Enter 不多建块', async () => {
      const { blockStore, editorStore } = setup()
      blockStore.blocks = [{
        id: 'b1', pageId: 'p1', parentId: null, pos: 0,
        content: 'hello', format: {}, type: 'bullet', createdAt: 0, updatedAt: 0,
        renderSegments: [{ start: 0, end: 5, type: 'text', value: 'hello' }]
      }]
      vi.spyOn(blockStore, 'getBlock').mockReturnValue(blockStore.blocks[0] as any)
      vi.spyOn(blockStore, 'flushSave').mockResolvedValue(undefined)
      // 源块已不存在 ⇒ 拆分无法兑现
      const insertSpy = vi.spyOn(blockStore, 'insertBlockAtCursor').mockResolvedValue(null)
      vi.spyOn(editorStore, 'deactivateBlock').mockImplementation(() => {})
      const activateSpy = vi.spyOn(editorStore, 'activateBlock').mockImplementation(() => {})

      const editorRef = ref({
        getText: () => 'hello',
        markSaved: () => {},
        cancelDebouncedSave: () => {},
      } as any)
      const lifecycle2 = useBlockEditorLifecycle({
        blockId: ref('b1'), pageId: 'p1',
        editorRef, cursorPos: ref(0), collapsed: ref(false),
        blockStore, editorStore, pageStore: usePageStore(),
        relationshipCleanup: useBlockRelationshipCleanup()
      })

      const p1 = lifecycle2.handleSplit(6)   // 失败
      const p2 = lifecycle2.handleSplit(6)   // 连按：落在 in-flight 窗口 → 计次 +1
      await Promise.all([p1, p2])
      expect(insertSpy).toHaveBeenCalledTimes(1)   // 无锚点可续 ⇒ 不再 drain

      // 后续一次正常 Enter：计次若悬挂，这里会多 drain 一个块（3 次 insert）
      const b2 = { id: 'b2', pageId: 'p1', parentId: null, pos: 1, content: '', format: {}, type: 'bullet', createdAt: 0, updatedAt: 0 }
      insertSpy.mockResolvedValue(b2 as any)
      await lifecycle2.handleSplit(6)

      expect(insertSpy).toHaveBeenCalledTimes(2)
      expect(activateSpy).toHaveBeenCalledTimes(1)
      expect(activateSpy).toHaveBeenLastCalledWith('b2', 1)
    })
  })

  describe('handleContentMousedown', () => {
    it('saves click coords for editor positioning', () => {
      const { lifecycle, editorStore } = setup()
      const setCoordsSpy = vi.spyOn(editorStore, 'setClickCoords').mockImplementation(() => {})
      const e = {
        target: { closest: () => null },
        button: 0,
        ctrlKey: false, metaKey: false,
        clientX: 100, clientY: 200,
        preventDefault: () => {}
      } as any
      lifecycle.handleContentMousedown(e)
      expect(setCoordsSpy).toHaveBeenCalledWith(100, 200)
    })

    it('skips when clicking .block-link', () => {
      const { lifecycle, editorStore } = setup()
      const setCoordsSpy = vi.spyOn(editorStore, 'setClickCoords').mockImplementation(() => {})
      const e = {
        target: { closest: (sel: string) => sel === '.block-link' ? {} : null },
        ctrlKey: false, metaKey: false,
        clientX: 100, clientY: 200,
        preventDefault: () => {}
      } as any
      lifecycle.handleContentMousedown(e)
      expect(setCoordsSpy).not.toHaveBeenCalled()
    })

    it('skips when clicking .rel-type-label', () => {
      const { lifecycle, editorStore } = setup()
      const setCoordsSpy = vi.spyOn(editorStore, 'setClickCoords').mockImplementation(() => {})
      const e = {
        target: { closest: (sel: string) => sel === '.rel-type-label' ? {} : null },
        ctrlKey: false, metaKey: false,
        clientX: 100, clientY: 200,
        preventDefault: () => {}
      } as any
      lifecycle.handleContentMousedown(e)
      expect(setCoordsSpy).not.toHaveBeenCalled()
    })

    it('skips when clicking .date-ref', () => {
      const { lifecycle, editorStore } = setup()
      const setCoordsSpy = vi.spyOn(editorStore, 'setClickCoords').mockImplementation(() => {})
      const e = {
        target: { closest: (sel: string) => sel === '.date-ref' ? {} : null },
        ctrlKey: false, metaKey: false,
        clientX: 100, clientY: 200,
        preventDefault: () => {}
      } as any
      lifecycle.handleContentMousedown(e)
      expect(setCoordsSpy).not.toHaveBeenCalled()
    })

    it('skips when clicking .block-tag（chip 需存活到 click 才能导航，ADR-0050 D7）', () => {
      const { lifecycle, editorStore } = setup()
      const setCoordsSpy = vi.spyOn(editorStore, 'setClickCoords').mockImplementation(() => {})
      const e = {
        target: { closest: (sel: string) => sel === '.block-tag' ? {} : null },
        ctrlKey: false, metaKey: false,
        clientX: 100, clientY: 200,
        preventDefault: () => {}
      } as any
      lifecycle.handleContentMousedown(e)
      expect(setCoordsSpy).not.toHaveBeenCalled()
    })

    it('编辑态（.ProseMirror 在场）命中 .block-tag 不再提前 return —— 放行文本选区追踪', () => {
      // 块激活后 inline tag 装饰也挂着 .block-tag；守卫若照旧吞掉 mousedown，
      // 从装饰字符内起拖将无法跨块选区（ADR-0035 老 bug 形态）。
      const { lifecycle, editorStore } = setup()
      const setCoordsSpy = vi.spyOn(editorStore, 'setClickCoords').mockImplementation(() => {})
      const e = {
        target: {
          closest: (sel: string) => (sel === '.ProseMirror' || sel === '.block-tag') ? {} : null,
        },
        button: 0,
        ctrlKey: false, metaKey: false,
        clientX: 100, clientY: 200,
        preventDefault: () => {}
      } as any
      lifecycle.handleContentMousedown(e)
      expect(setCoordsSpy).toHaveBeenCalledWith(100, 200)
    })

    // ── 起点在激活块：手势必须与非激活块同构 ──
    // 旧实现「已激活的 block 交给 ProseMirror 原生处理光标定位」直接 return，
    // 文本追踪根本不启动 → ProseMirror 独占拖拽，comind 无从接管（拖不出本块）。

    /** 内容区左键 mousedown（未命中 .block-link / .rel-type-label / .date-ref） */
    function contentMousedown(): MouseEvent {
      return {
        target: { closest: () => null },
        button: 0,
        ctrlKey: false, metaKey: false,
        clientX: 10, clientY: 20,
        preventDefault: () => {}
      } as unknown as MouseEvent
    }

    it('已激活块：仍启动文本选区追踪（回归：起点在激活块内拖不出本块）', () => {
      const startTextTracking = vi.fn()
      const { lifecycle, editorStore } = setup({ startTextTracking, toggleBlock: vi.fn() })
      editorStore.activateBlock('b1')
      blockOffsetFromPointMock.mockReturnValue({ blockId: 'b1', offset: 3 })

      lifecycle.handleContentMousedown(contentMousedown())

      expect(startTextTracking).toHaveBeenCalledWith({ blockId: 'b1', offset: 3 }, { x: 10, y: 20 })
    })

    it('已激活块：不设 clickCoords —— 光标定位仍归 ProseMirror', () => {
      const { lifecycle, editorStore } = setup({ startTextTracking: vi.fn(), toggleBlock: vi.fn() })
      editorStore.activateBlock('b1')
      const setCoordsSpy = vi.spyOn(editorStore, 'setClickCoords').mockImplementation(() => {})
      blockOffsetFromPointMock.mockReturnValue(null)

      lifecycle.handleContentMousedown(contentMousedown())

      expect(setCoordsSpy).not.toHaveBeenCalled()
    })

    it('未激活块：既设 clickCoords 也启动追踪（对照组）', () => {
      const startTextTracking = vi.fn()
      const { lifecycle, editorStore } = setup({ startTextTracking, toggleBlock: vi.fn() })
      const setCoordsSpy = vi.spyOn(editorStore, 'setClickCoords').mockImplementation(() => {})
      blockOffsetFromPointMock.mockReturnValue({ blockId: 'b1', offset: 0 })

      lifecycle.handleContentMousedown(contentMousedown())

      expect(setCoordsSpy).toHaveBeenCalledWith(10, 20)
      expect(startTextTracking).toHaveBeenCalledWith({ blockId: 'b1', offset: 0 }, { x: 10, y: 20 })
    })

    // ── shift+click：延伸已有文本选区（ADR-0035 D10）──

    /** shift+左键 mousedown */
    function shiftMousedown(pd: () => void = () => {}): MouseEvent {
      return {
        target: { closest: () => null },
        button: 0,
        shiftKey: true,
        ctrlKey: false, metaKey: false,
        clientX: 30, clientY: 40,
        preventDefault: pd
      } as unknown as MouseEvent
    }

    /** 带既有文本选区的 selection stub */
    function selectionWithRange() {
      return {
        textRange: { value: { anchor: { blockId: 'b1', offset: 0 }, head: { blockId: 'b1', offset: 2 } } },
        startTextTracking: vi.fn(),
        startTextExtend: vi.fn(),
        toggleBlock: vi.fn()
      }
    }

    it('已有文本选区：head 延伸到点击处并 preventDefault，不走激活路径', () => {
      const sel = selectionWithRange()
      const { lifecycle, editorStore } = setup(sel)
      const setCoordsSpy = vi.spyOn(editorStore, 'setClickCoords').mockImplementation(() => {})
      const pd = vi.fn()
      blockOffsetFromPointMock.mockReturnValue({ blockId: 'b2', offset: 4 })

      lifecycle.handleContentMousedown(shiftMousedown(pd))

      expect(sel.startTextExtend).toHaveBeenCalledWith({ blockId: 'b2', offset: 4 }, { x: 30, y: 40 })
      expect(pd).toHaveBeenCalled()
      // 延伸不是新建选区，也不激活编辑器（不重定位光标）
      expect(sel.startTextTracking).not.toHaveBeenCalled()
      expect(setCoordsSpy).not.toHaveBeenCalled()
    })

    it('无文本选区但有光标：从光标起选 + preventDefault + 失活编辑器，不走激活路径', () => {
      const sel = { textRange: { value: null }, startTextTracking: vi.fn(), startTextExtend: vi.fn(), toggleBlock: vi.fn() }
      const { lifecycle, editorStore } = setup(sel)
      const deactivateSpy = vi.spyOn(editorStore, 'deactivateBlock').mockImplementation(() => {})
      const setCoordsSpy = vi.spyOn(editorStore, 'setClickCoords').mockImplementation(() => {})
      const pd = vi.fn()
      blockOffsetFromPointMock.mockReturnValue({ blockId: 'b2', offset: 4 })
      caretBlockOffsetMock.mockReturnValue({ blockId: 'b1', offset: 2 })

      lifecycle.handleContentMousedown(shiftMousedown(pd))

      expect(sel.startTextExtend).toHaveBeenCalledWith(
        { blockId: 'b2', offset: 4 },
        { x: 30, y: 40 },
        { blockId: 'b1', offset: 2 }
      )
      expect(pd).toHaveBeenCalled()
      // 光标在激活块编辑器里：起选即失活（PM 挂载与 comind 文本选区不并存）
      expect(deactivateSpy).toHaveBeenCalled()
      expect(setCoordsSpy).not.toHaveBeenCalled()
      expect(sel.startTextTracking).not.toHaveBeenCalled()
    })

    it('无文本选区且无光标：退化为普通路径（照常启动拖拽追踪）', () => {
      const sel = { textRange: { value: null }, startTextTracking: vi.fn(), startTextExtend: vi.fn(), toggleBlock: vi.fn() }
      const { lifecycle, editorStore } = setup(sel)
      const setCoordsSpy = vi.spyOn(editorStore, 'setClickCoords').mockImplementation(() => {})
      blockOffsetFromPointMock.mockReturnValue({ blockId: 'b1', offset: 1 })
      caretBlockOffsetMock.mockReturnValue(null)

      lifecycle.handleContentMousedown(shiftMousedown())

      expect(sel.startTextTracking).toHaveBeenCalledWith({ blockId: 'b1', offset: 1 }, { x: 30, y: 40 })
      expect(sel.startTextExtend).not.toHaveBeenCalled()
      expect(setCoordsSpy).toHaveBeenCalledWith(30, 40)
    })

    it('点击处无有效偏移：不延伸、不启动普通拖拽、不 preventDefault（shift 语义下不误发）', () => {
      const sel = selectionWithRange()
      const { lifecycle } = setup(sel)
      const pd = vi.fn()
      blockOffsetFromPointMock.mockReturnValue(null)

      lifecycle.handleContentMousedown(shiftMousedown(pd))

      expect(sel.startTextExtend).not.toHaveBeenCalled()
      expect(sel.startTextTracking).not.toHaveBeenCalled()
      expect(pd).not.toHaveBeenCalled()
    })
  })

  describe('handleContentClick', () => {
    it('navigates to page on wiki link click', () => {
      const { lifecycle } = setup()
      const link: any = {
        dataset: { page: 'MyPage' },
      }
      link.closest = (sel: string) => sel === '.block-link' ? link : null
      const e = {
        target: link,
        preventDefault: () => {},
        stopPropagation: () => {}
      } as any
      lifecycle.handleContentClick(e)
      expect(navigateToPageMock).toHaveBeenCalledWith('MyPage')
    })

    it('opens external link via window.open', () => {
      const { lifecycle } = setup()
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
      const link: any = {
        dataset: { external: 'https://example.com' },
      }
      link.closest = (sel: string) => sel === '.block-link' ? link : null
      const e = {
        target: link,
        preventDefault: () => {},
        stopPropagation: () => {}
      } as any
      lifecycle.handleContentClick(e)
      expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')
    })

    it('opens relationship switch menu on rel-type-label click', () => {
      const { lifecycle } = setup()
      const relLabel: any = {
        dataset: {
          relType: 'relates',
          blockId: 'b1',
          typedFrom: '0',
          typedTo: '5'
        },
        getBoundingClientRect: () => ({
          left: 10, top: 20, bottom: 40, right: 100, width: 90, height: 20
        })
      }
      relLabel.closest = (sel: string) => sel === '.rel-type-label' ? relLabel : null
      const e = {
        target: relLabel,
        preventDefault: () => {},
        stopPropagation: () => {}
      } as any
      lifecycle.handleContentClick(e)
      expect(relMenuMock.openSwitch).toHaveBeenCalledTimes(1)
      expect(relMenuMock.openSwitch).toHaveBeenCalledWith(
        expect.objectContaining({
          currentType: 'relates',
          range: { from: 0, to: 5 },
          position: { x: 10, y: 44 }
        })
      )
    })

    it('does nothing on non-link click', () => {
      const { lifecycle } = setup()
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
      const e = {
        target: { closest: () => null },
        preventDefault: () => {},
        stopPropagation: () => {}
      } as any
      lifecycle.handleContentClick(e)
      expect(navigateToPageMock).not.toHaveBeenCalled()
      expect(openSpy).not.toHaveBeenCalled()
      expect(relMenuMock.openSwitch).not.toHaveBeenCalled()
    })

    // ── inline `#tag` chip（ADR-0050 D7）──

    /** 结构化 Tag 段渲染出的裸 chip（有 data-tag-id、无 data-page） */
    function tagChip(dataset: Record<string, string>): any {
      const chip: any = { dataset }
      chip.closest = (sel: string) => sel === '.block-tag' ? chip : null
      return chip
    }

    it('navigates to tag aggregate page on inline tag chip click', () => {
      const { lifecycle } = setup()
      const e = {
        target: tagChip({ tagId: 't-1', tagTitle: '项目' }),
        preventDefault: () => {},
        stopPropagation: () => {}
      } as any
      lifecycle.handleContentClick(e)
      expect(navigateToTagMock).toHaveBeenCalledWith('t-1')
      // 不得误入 wiki-link 分支
      expect(navigateToPageMock).not.toHaveBeenCalled()
    })

    it('no-op on tag chip without data-tag-id (渲染快照查无此 tag)', () => {
      const { lifecycle } = setup()
      const e = {
        target: tagChip({ tagTitle: '未落库' }),
        preventDefault: () => {},
        stopPropagation: () => {}
      } as any
      lifecycle.handleContentClick(e)
      expect(navigateToTagMock).not.toHaveBeenCalled()
      expect(navigateToPageMock).not.toHaveBeenCalled()
    })

    // ── date-ref 阅读态点击（span 由 useContentRenderer 渲染）──

    /**
     * 渲染态 date-ref span。raw 带尾随空格模拟「段范围含 pad」的真实产出
     * （键盘语义里 pad 属单元一部分，渲染态 span 连右 pad 一起盖）。
     */
    function dateRefSpanStub(dataset: Record<string, string>): any {
      const span: any = { dataset }
      span.closest = (sel: string) => {
        if (sel === '.date-ref') return span
        if (sel === '.block-text') return { querySelectorAll: () => [span] }
        return null
      }
      span.getBoundingClientRect = () => ({
        left: 10, top: 20, bottom: 40, right: 100, width: 90, height: 20
      })
      return span
    }

    it('opens date-ref panel on render-mode date-ref click（data-raw 含 pad 空格）', () => {
      const { lifecycle, blockStore } = setup()
      // 'meet @2026-07-15T14:00 📅|weekly tomorrow'：单元起点 5，序列化长度 27（📅 占 2 个 UTF-16 码元）
      blockStore.blocks[0].content = 'meet @2026-07-15T14:00 📅|weekly tomorrow'
      const e = {
        target: dateRefSpanStub({
          kind: 'schedule',
          iso: '2026-07-15T14:00',
          recurrence: 'weekly',
          leadMinutes: '0',
          raw: '@2026-07-15T14:00 📅|weekly ',
        }),
        preventDefault: () => {},
        stopPropagation: () => {}
      } as any
      lifecycle.handleContentClick(e)
      expect(openDateRefPanelMock).toHaveBeenCalledTimes(1)
      const [cfg, source] = openDateRefPanelMock.mock.calls[0]
      expect(source).toBe('content')
      expect(cfg.from).toBe(5)
      // to 用序列化单元长度（27，不含尾随 pad 空格）——曾因 raw 含空格比对失败而静默 return
      expect(cfg.to).toBe(32)
      expect(cfg.kind).toBe('schedule')
      expect(cfg.iso).toBe('2026-07-15T14:00')
    })

    it('opens date-ref panel on render-mode date-ref click（data-raw 无 pad 空格同样通过）', () => {
      const { lifecycle, blockStore } = setup()
      blockStore.blocks[0].content = 'meet @2026-07-15T14:00 📅|weekly tomorrow'
      const e = {
        target: dateRefSpanStub({
          kind: 'schedule',
          iso: '2026-07-15T14:00',
          recurrence: 'weekly',
          leadMinutes: '0',
          raw: '@2026-07-15T14:00 📅|weekly',
        }),
        preventDefault: () => {},
        stopPropagation: () => {}
      } as any
      lifecycle.handleContentClick(e)
      expect(openDateRefPanelMock).toHaveBeenCalledTimes(1)
      expect(openDateRefPanelMock.mock.calls[0][0].from).toBe(5)
      expect(openDateRefPanelMock.mock.calls[0][0].to).toBe(32)
    })
  })

  describe('handleCursorChange', () => {
    it('updates cursorPos ref', () => {
      const { lifecycle, cursorPos } = setup()
      lifecycle.handleCursorChange(42)
      expect(cursorPos.value).toBe(42)
    })
  })

  describe('handleClear', () => {
    it('calls updateBlockContent with empty string', async () => {
      const { lifecycle, blockStore } = setup()
      const spy = vi.spyOn(blockStore, 'updateBlockContent').mockResolvedValue(undefined)
      await lifecycle.handleClear()
      expect(spy).toHaveBeenCalledWith('b1', '')
    })
  })

  describe('isActive', () => {
    it('is true when editorStore.activeBlockId equals blockId', () => {
      const { lifecycle, editorStore } = setup()
      expect(lifecycle.isActive.value).toBe(false)
      editorStore.activateBlock('b1')
      expect(lifecycle.isActive.value).toBe(true)
    })
  })
})
