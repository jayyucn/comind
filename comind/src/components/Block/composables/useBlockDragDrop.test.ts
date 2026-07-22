import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'
import { useBlockDragDrop } from './useBlockDragDrop'
import { useBlockStore } from '../../../stores/blocks'
import { usePageStore } from '../../../stores/pages'
import type { Block } from '../../../types/block'

function makeBlock(overrides: Partial<Block> = {}): Block {
  return {
    id: 'b1',
    pageId: 'p1',
    parentId: null,
    pos: 0,
    content: '',
    format: {},
    type: 'bullet',
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

describe('useBlockDragDrop', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  describe('handleBlockDragEnd', () => {
    it('calls moveBlock with correct params when dropTarget is sort', async () => {
      const blockId = ref('b1')
      const blockStore = useBlockStore()
      const pageStore = usePageStore()
      // 原始 handleBlockDragEnd 通过 pageStore.currentPageId 过滤同级 block
      pageStore.currentPageId = 'p1'
      const moveSpy = vi.spyOn(blockStore, 'moveBlock').mockResolvedValue(undefined)
      blockStore.blocks = [
        makeBlock({ id: 'b1', pos: 0 }),
        makeBlock({ id: 'b2', pos: 1000 })
      ]
      const { setDropTarget, handleBlockDragEnd } = useBlockDragDrop({
        blockId,
        pageId: 'p1',
        blockStore,
        pageStore
      })
      setDropTarget({ action: 'sort', toParentId: null, beforeId: 'b2' })
      // handleBlockDragEnd reads .block-chosen from DOM to find draggedId
      vi.spyOn(document, 'querySelector').mockReturnValue({
        dataset: { blockId: 'b1' }
      } as any)
      await handleBlockDragEnd()
      // 原始逻辑：siblings = [b1, b2]，beforeId='b2' 的 insertIdx=1
      // 保持原始行为（含 dragged block 在 siblings 中）
      expect(moveSpy).toHaveBeenCalledWith({
        blockId: 'b1',
        toParentId: null,
        newIndex: 1
      })
    })

    it('clears drop target and indicator visibility after drag end', async () => {
      const blockId = ref('b1')
      const blockStore = useBlockStore()
      const pageStore = usePageStore()
      pageStore.currentPageId = 'p1'
      vi.spyOn(blockStore, 'moveBlock').mockResolvedValue(undefined)
      blockStore.blocks = [
        makeBlock({ id: 'b1', pos: 0 }),
        makeBlock({ id: 'b2', pos: 1000 })
      ]
      const { setDropTarget, handleBlockDragEnd, indicatorVisible } =
        useBlockDragDrop({
          blockId,
          pageId: 'p1',
          blockStore,
          pageStore
        })
      setDropTarget({ action: 'sort', toParentId: null, beforeId: null })
      vi.spyOn(document, 'querySelector').mockReturnValue({
        dataset: { blockId: 'b1' }
      } as any)
      await handleBlockDragEnd()
      expect(indicatorVisible.value).toBe(false)
    })

    it('calls onDragEnd callback after drag end', async () => {
      const blockId = ref('b1')
      const blockStore = useBlockStore()
      const pageStore = usePageStore()
      pageStore.currentPageId = 'p1'
      vi.spyOn(blockStore, 'moveBlock').mockResolvedValue(undefined)
      blockStore.blocks = [makeBlock({ id: 'b1', pos: 0 })]
      const onDragEnd = vi.fn()
      const { handleBlockDragEnd } = useBlockDragDrop({
        blockId,
        pageId: 'p1',
        blockStore,
        pageStore,
        onDragEnd
      })
      vi.spyOn(document, 'querySelector').mockReturnValue({
        dataset: { blockId: 'b1' }
      } as any)
      await handleBlockDragEnd()
      expect(onDragEnd).toHaveBeenCalled()
    })

    it('does nothing when no dropTarget set', async () => {
      const blockId = ref('b1')
      const blockStore = useBlockStore()
      const pageStore = usePageStore()
      const moveSpy = vi.spyOn(blockStore, 'moveBlock').mockResolvedValue(undefined)
      const { handleBlockDragEnd, indicatorVisible } = useBlockDragDrop({
        blockId,
        pageId: 'p1',
        blockStore,
        pageStore
      })
      await handleBlockDragEnd()
      expect(moveSpy).not.toHaveBeenCalled()
      expect(indicatorVisible.value).toBe(false)
    })
  })

  describe('handleDragMove cycle prevention', () => {
    it('returns false when dragging parent into its own descendant container', () => {
      const blockId = ref('b1')
      const blockStore = useBlockStore()
      const pageStore = usePageStore()
      blockStore.blocks = [
        makeBlock({ id: 'b1', parentId: null, pos: 0 }),
        makeBlock({ id: 'b2', parentId: 'b1', pos: 1000 })
      ]
      const { handleDragMove } = useBlockDragDrop({
        blockId,
        pageId: 'p1',
        blockStore,
        pageStore
      })
      const evt = {
        dragged: { dataset: { blockId: 'b1' } },
        related: { closest: () => ({ dataset: { blockId: 'b2' } }) },
        to: { dataset: { parentId: 'b1' } },
        originalEvent: { clientX: 0, clientY: 0 }
      }
      const result = handleDragMove(evt as any)
      expect(result).toBe(false)
    })

    it('returns false when dropping block onto itself', () => {
      const blockId = ref('b1')
      const blockStore = useBlockStore()
      const pageStore = usePageStore()
      blockStore.blocks = [makeBlock({ id: 'b1', pos: 0 })]
      const { handleDragMove } = useBlockDragDrop({
        blockId,
        pageId: 'p1',
        blockStore,
        pageStore
      })
      const evt = {
        dragged: { dataset: { blockId: 'b1' } },
        related: { closest: () => ({ dataset: { blockId: 'b1' } }) },
        to: { dataset: { parentId: null } },
        originalEvent: { clientX: 0, clientY: 0 }
      }
      const result = handleDragMove(evt as any)
      expect(result).toBe(false)
    })
  })

  describe('indicator reactivity', () => {
    it('clearIndicator sets indicatorVisible to false', () => {
      const blockId = ref('b1')
      const blockStore = useBlockStore()
      const pageStore = usePageStore()
      const { clearIndicator, indicatorVisible } = useBlockDragDrop({
        blockId,
        pageId: 'p1',
        blockStore,
        pageStore
      })
      // even if not visible, clearIndicator should be a safe no-op
      clearIndicator()
      expect(indicatorVisible.value).toBe(false)
    })

    it('setDropTarget stores drop target for handleBlockDragEnd', async () => {
      const blockId = ref('b1')
      const blockStore = useBlockStore()
      const pageStore = usePageStore()
      pageStore.currentPageId = 'p1'
      const moveSpy = vi.spyOn(blockStore, 'moveBlock').mockResolvedValue(undefined)
      blockStore.blocks = [
        makeBlock({ id: 'b1', pos: 0 }),
        makeBlock({ id: 'b2', pos: 1000 })
      ]
      const { setDropTarget, handleBlockDragEnd } = useBlockDragDrop({
        blockId,
        pageId: 'p1',
        blockStore,
        pageStore
      })
      setDropTarget({ action: 'sort', toParentId: null, beforeId: 'b2' })
      vi.spyOn(document, 'querySelector').mockReturnValue({
        dataset: { blockId: 'b1' }
      } as any)
      await handleBlockDragEnd()
      expect(moveSpy).toHaveBeenCalled()
    })
  })
})
