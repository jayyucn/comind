import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBlockDragDrop, resolveDropAction, applyDropTarget } from './useBlockDragDrop'
import type { DropTargetGeometry } from './useBlockDragDrop'
import { useBlockStore } from '../../../stores/blocks'
import type { Block, TreeNode } from '../../../types/block'

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

function makeNode(id: string, children: TreeNode[] = []): TreeNode {
  return { id, block: makeBlock({ id }), children }
}

describe('useBlockDragDrop', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  describe('handleBlockDragEnd', () => {
    it('clears indicator and calls onDragEnd', () => {
      const blockStore = useBlockStore()
      const onDragEnd = vi.fn()
      const { handleBlockDragEnd, indicatorVisible } = useBlockDragDrop({
        blockStore,
        onDragEnd
      })
      // 模拟拖拽中指示器已显示
      indicatorVisible.value = true
      handleBlockDragEnd()
      expect(indicatorVisible.value).toBe(false)
      // 未经 handleDragMove 产生意图 → 回传 null（调用方不做校正）
      expect(onDragEnd).toHaveBeenCalledWith(null)
    })

    it('is a safe no-op when onDragEnd is not provided', () => {
      const blockStore = useBlockStore()
      const { handleBlockDragEnd } = useBlockDragDrop({
        blockStore
      })
      expect(() => handleBlockDragEnd()).not.toThrow()
    })
  })

  describe('handleDragMove cycle prevention', () => {
    it('returns false when dragging parent into its own descendant container', () => {
      const blockStore = useBlockStore()
      blockStore.blocks = [
        makeBlock({ id: 'b1', parentId: null, pos: 0 }),
        makeBlock({ id: 'b2', parentId: 'b1', pos: 1000 })
      ]
      const { handleDragMove } = useBlockDragDrop({
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
      const blockStore = useBlockStore()
      blockStore.blocks = [makeBlock({ id: 'b1', pos: 0 })]
      const { handleDragMove } = useBlockDragDrop({
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
      const blockStore = useBlockStore()
      const { clearIndicator, indicatorVisible } = useBlockDragDrop({
        blockStore
      })
      // 即使当前未显示，clearIndicator 也应是安全的 no-op
      clearIndicator()
      expect(indicatorVisible.value).toBe(false)
    })
  })
})

describe('applyDropTarget', () => {
  /** 根级 [A, B[C1, C2], D] */
  function makeTree(): TreeNode[] {
    return [makeNode('A'), makeNode('B', [makeNode('B1'), makeNode('B2')]), makeNode('C')]
  }
  const ids = (list: TreeNode[]) => list.map(n => n.id)

  it('sort：同级移动到目标块之前', () => {
    const tree = makeTree()
    expect(applyDropTarget(tree, 'C', { action: 'sort', toParentId: null, beforeId: 'A' })).toBe(true)
    expect(ids(tree)).toEqual(['C', 'A', 'B'])
  })

  it('sort：beforeId 为 null 时追加到同级末尾', () => {
    const tree = makeTree()
    expect(applyDropTarget(tree, 'A', { action: 'sort', toParentId: null, beforeId: null })).toBe(true)
    expect(ids(tree)).toEqual(['B', 'C', 'A'])
  })

  it('nest：移入目标块的子级末尾', () => {
    const tree = makeTree()
    expect(applyDropTarget(tree, 'C', { action: 'nest', toParentId: 'B', beforeId: null })).toBe(true)
    expect(ids(tree)).toEqual(['A', 'B'])
    expect(ids(tree[1].children)).toEqual(['B1', 'B2', 'C'])
  })

  it('promote：提升到目标块的父级、位于目标之前', () => {
    const tree = makeTree()
    expect(applyDropTarget(tree, 'B1', { action: 'promote', toParentId: null, beforeId: 'B' })).toBe(true)
    expect(ids(tree)).toEqual(['A', 'B1', 'B', 'C'])
    expect(ids(tree.find(n => n.id === 'B')!.children)).toEqual(['B2'])
  })

  it('跨容器：子块移入另一父块下，原容器同时摘除', () => {
    const tree = [makeNode('A', [makeNode('A1')]), makeNode('B', [makeNode('B1')])]
    expect(applyDropTarget(tree, 'A1', { action: 'nest', toParentId: 'B', beforeId: null })).toBe(true)
    expect(tree[0].children).toEqual([])
    expect(ids(tree[1].children)).toEqual(['B1', 'A1'])
  })

  it('拒绝移入自身子树', () => {
    const tree = makeTree()
    expect(applyDropTarget(tree, 'B', { action: 'nest', toParentId: 'B1', beforeId: null })).toBe(false)
    expect(ids(tree)).toEqual(['A', 'B', 'C'])
  })

  it('目标即自身位置时不移动', () => {
    const tree = makeTree()
    expect(applyDropTarget(tree, 'B', { action: 'sort', toParentId: null, beforeId: 'B' })).toBe(false)
    expect(applyDropTarget(tree, 'B', { action: 'nest', toParentId: 'B', beforeId: null })).toBe(false)
  })

  it('无 action 或被拖块不存在时不移动', () => {
    const tree = makeTree()
    expect(applyDropTarget(tree, 'B', { action: null, toParentId: null, beforeId: null })).toBe(false)
    expect(applyDropTarget(tree, 'ZZ', { action: 'nest', toParentId: 'B', beforeId: null })).toBe(false)
    expect(ids(tree)).toEqual(['A', 'B', 'C'])
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
