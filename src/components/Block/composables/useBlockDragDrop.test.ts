import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'
import { useBlockDragDrop, resolveDropAction } from './useBlockDragDrop'
import type { DropTargetGeometry } from './useBlockDragDrop'
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

describe('resolveDropAction', () => {
  /** bullet 矩形 x 100..150、y 100..130 → 左区 x<=115、右区 x>=135、中线 y=115 */
  const bulletRect = { left: 100, right: 150, top: 100, height: 30 }

  function geometry(overrides: Partial<DropTargetGeometry> = {}): DropTargetGeometry {
    return {
      blockId: 'b2',
      parentId: 'b1',
      nextSiblingId: 'b3',
      bulletRect,
      ...overrides
    }
  }

  it('returns null when the target block has no bullet', () => {
    expect(resolveDropAction({ x: 120, y: 110 }, geometry({ bulletRect: null }))).toBeNull()
  })

  it('promotes to the parent when cursor is in the left zone', () => {
    expect(resolveDropAction({ x: 110, y: 110 }, geometry())).toEqual({
      action: 'promote',
      toParentId: 'b1',
      beforeId: 'b2'
    })
  })

  it('falls back to sort at root level when left zone has no parent', () => {
    expect(resolveDropAction({ x: 110, y: 110 }, geometry({ parentId: null }))).toEqual({
      action: 'sort',
      toParentId: null,
      beforeId: 'b2'
    })
  })

  it('nests into the target when cursor is in the right zone', () => {
    expect(resolveDropAction({ x: 140, y: 110 }, geometry())).toEqual({
      action: 'nest',
      toParentId: 'b2',
      beforeId: null
    })
  })

  it('sorts before the target in the upper half of the center zone', () => {
    expect(resolveDropAction({ x: 125, y: 110 }, geometry())).toEqual({
      action: 'sort',
      toParentId: 'b1',
      beforeId: 'b2'
    })
  })

  it('sorts before the next sibling in the lower half of the center zone', () => {
    expect(resolveDropAction({ x: 125, y: 120 }, geometry())).toEqual({
      action: 'sort',
      toParentId: 'b1',
      beforeId: 'b3'
    })
  })

  it('appends to the end when there is no next sibling', () => {
    expect(resolveDropAction({ x: 125, y: 120 }, geometry({ nextSiblingId: null }))).toEqual({
      action: 'sort',
      toParentId: 'b1',
      beforeId: null
    })
  })

  it('treats exact threshold boundaries as left and right zones', () => {
    expect(resolveDropAction({ x: 115, y: 110 }, geometry())?.action).toBe('promote')
    expect(resolveDropAction({ x: 135, y: 110 }, geometry())?.action).toBe('nest')
  })
})
