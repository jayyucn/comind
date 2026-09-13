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
// 单元测试不在组件 setup 中运行，mock 掉以避免 Vue 警告
vi.mock('../../../composables/useDateTimePickerPanel', async () => {
  const actual = await vi.importActual<typeof import('../../../composables/useDateTimePickerPanel')>(
    '../../../composables/useDateTimePickerPanel'
  )
  return {
    ...actual,
    useDateRefClickListener: vi.fn()
  }
})

// selection-geometry 依赖 document.elementFromPoint / caretRangeFromPoint（jsdom 无布局），
// 桩掉它才能断言 handleContentMousedown 是否真的启动了文本选区追踪。
const { blockOffsetFromPointMock } = vi.hoisted(() => ({
  blockOffsetFromPointMock: vi.fn()
}))

vi.mock('../../../services/selection-geometry', () => ({
  blockOffsetFromPoint: blockOffsetFromPointMock
}))

describe('useBlockEditorLifecycle', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    blockOffsetFromPointMock.mockReset()
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
    it('calls blockStore.updateBlockContent', async () => {
      const { lifecycle, blockStore } = setup()
      const spy = vi.spyOn(blockStore, 'updateBlockContent').mockResolvedValue(undefined)
      await lifecycle.handleSave('new content')
      expect(spy).toHaveBeenCalledWith('b1', 'new content')
    })
  })

  describe('handleLanguageChange', () => {
    it('calls blockStore.updateBlockProperties with language', async () => {
      const { lifecycle, blockStore } = setup()
      const spy = vi.spyOn(blockStore, 'updateBlockProperties').mockResolvedValue(undefined)
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
      vi.spyOn(blockStore, 'findPreviousBlockInTreeOrder').mockReturnValue(prevBlock as any)
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
      expect(blockStore.insertBlockAtCursor).toHaveBeenCalledWith('b1', 5, false)
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
  })

  describe('handleContentMousedown', () => {
    it('saves click coords for editor positioning', () => {
      const { lifecycle, editorStore } = setup()
      const setCoordsSpy = vi.spyOn(editorStore, 'setClickCoords').mockImplementation(() => {})
      const e = {
        target: { closest: () => null },
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
          labelFrom: '0',
          labelTo: '5'
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
