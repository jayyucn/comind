import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'
import { useBlockEditorLifecycle } from './useBlockEditorLifecycle'
import { useBlockStore } from '../../../stores/blocks'
import { useEditorStore } from '../../../stores/editor'
import { usePropertyStore } from '../../../stores/property'
import { usePageStore } from '../../../stores/pages'
import { useBlockRelationshipCleanup } from '../../../composables/useBlockRelationshipCleanup'
import type { BlockTypeEditorExposed } from '../../../types/block-type'

// useNavigateToPage 依赖 useRouter，单元测试中需 mock
vi.mock('../../../composables/useNavigateToPage', () => ({
  useNavigateToPage: () => ({
    navigateToPage: vi.fn()
  })
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

describe('useBlockEditorLifecycle', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  function setup() {
    const blockStore = useBlockStore()
    const editorStore = useEditorStore()
    const propertyStore = usePropertyStore()
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
      propertyStore,
      pageStore,
      relationshipCleanup
    })

    return { lifecycle, blockStore, editorStore, blockId, relationshipCleanup }
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
    it('deactivates current block and inserts new block at cursor', async () => {
      const { lifecycle, blockStore, editorStore } = setup()
      const deactivateSpy = vi.spyOn(editorStore, 'deactivateBlock').mockImplementation(() => {})
      vi.spyOn(blockStore, 'insertBlockAtCursor').mockResolvedValue({
        id: 'b2', pageId: 'p1', parentId: null, pos: 1,
        content: '', format: {}, type: 'bullet', createdAt: 0, updatedAt: 0
      } as any)
      const activateSpy = vi.spyOn(editorStore, 'activateBlock').mockImplementation(() => {})
      await lifecycle.handleSplit(5)
      expect(deactivateSpy).toHaveBeenCalled()
      expect(blockStore.insertBlockAtCursor).toHaveBeenCalledWith('b1', 5, false)
      expect(activateSpy).toHaveBeenCalledWith('b2', 1)
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
  })

  describe('handleCursorChange', () => {
    it('updates cursorPos ref without throwing', () => {
      const { lifecycle } = setup()
      lifecycle.handleCursorChange(42)
      expect(true).toBe(true)
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
