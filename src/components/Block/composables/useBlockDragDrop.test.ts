import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'
import { useBlockDragDrop } from './useBlockDragDrop'
import { useBlockStore } from '../../../stores/blocks'
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
    it('clears indicator and calls onDragEnd', () => {
      const blockId = ref('b1')
      const blockStore = useBlockStore()
      const onDragEnd = vi.fn()
      const { handleBlockDragEnd, indicatorVisible } = useBlockDragDrop({
        blockId,
        pageId: 'p1',
        blockStore,
        onDragEnd
      })
      // 模拟拖拽中指示器已显示
      indicatorVisible.value = true
      handleBlockDragEnd()
      expect(indicatorVisible.value).toBe(false)
      expect(onDragEnd).toHaveBeenCalledTimes(1)
    })

    it('is a safe no-op when onDragEnd is not provided', () => {
      const blockId = ref('b1')
      const blockStore = useBlockStore()
      const { handleBlockDragEnd } = useBlockDragDrop({
        blockId,
        pageId: 'p1',
        blockStore
      })
      expect(() => handleBlockDragEnd()).not.toThrow()
    })
  })

  describe('handleDragMove cycle prevention', () => {
    it('returns false when dragging parent into its own descendant container', () => {
      const blockId = ref('b1')
      const blockStore = useBlockStore()
      blockStore.blocks = [
        makeBlock({ id: 'b1', parentId: null, pos: 0 }),
        makeBlock({ id: 'b2', parentId: 'b1', pos: 1000 })
      ]
      const { handleDragMove } = useBlockDragDrop({
        blockId,
        pageId: 'p1',
        blockStore
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
      blockStore.blocks = [makeBlock({ id: 'b1', pos: 0 })]
      const { handleDragMove } = useBlockDragDrop({
        blockId,
        pageId: 'p1',
        blockStore
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
      const { clearIndicator, indicatorVisible } = useBlockDragDrop({
        blockId,
        pageId: 'p1',
        blockStore
      })
      // 即使当前未显示，clearIndicator 也应是安全的 no-op
      clearIndicator()
      expect(indicatorVisible.value).toBe(false)
    })
  })
})
