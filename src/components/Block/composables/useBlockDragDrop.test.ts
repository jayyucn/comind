import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBlockDragDrop, resolveDropAction, applyDropTarget } from './useBlockDragDrop'
import type { DragEndIntent, DropTargetGeometry } from './useBlockDragDrop'
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

/** 判定路径只读 bullet / row 的矩形；这里给出结构等价的替身（jsdom 没有布局） */
interface FakeRect {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

/** 行矩形：x 100..500（中区够宽），高 30 */
function ROW(top: number): FakeRect {
  return { left: 100, right: 500, top, bottom: top + 30, width: 400, height: 30 }
}

/** 拖拽容器（渲染 data-parent-id，根级为 ''） */
function makeContainer(): HTMLElement {
  const container = document.createElement('div')
  container.dataset.parentId = ''
  document.body.appendChild(container)
  return container
}

/** 假 block 元素：真 DOM 元素 + 覆写 getBoundingClientRect（jsdom 无布局） */
function makeBlockEl(id: string, rect: FakeRect, container: HTMLElement, className = 'block'): HTMLElement {
  const el = document.createElement('div')
  el.className = className
  el.dataset.blockId = id
  for (const childClass of ['block-row', 'block-bullet']) {
    const child = document.createElement('div')
    child.className = childClass
    child.getBoundingClientRect = () => rect as unknown as DOMRect
    el.appendChild(child)
  }
  container.appendChild(el)
  return el
}

/** 指针命中物（`document.elementFromPoint` 的返回值） */
function stubElementFromPoint(el: Element | null) {
  ;(document as unknown as { elementFromPoint: unknown }).elementFromPoint = vi.fn(() => el)
}

/** 走真实接线取出 hook 挂到 document 上的 pointermove 处理器 */
function startDrag(
  handleDragStart: (evt: unknown) => void,
  dragged: HTMLElement
): (e: { clientX: number; clientY: number }) => void {
  const add = vi.spyOn(document, 'addEventListener')
  handleDragStart({ targetEl: dragged })
  const handler = add.mock.calls.find(call => call[0] === 'pointermove')?.[1] as
    | ((e: { clientX: number; clientY: number }) => void)
    | undefined
  add.mockRestore()
  if (!handler) throw new Error('handleDragStart 未挂载 pointermove 监听')
  return handler
}

describe('useBlockDragDrop', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    stubElementFromPoint(null)
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

    it('拖拽结束回传的是「指针最后停住的位置」算出的意图', () => {
      const blockStore = useBlockStore()
      const onDragEnd = vi.fn()
      const hook = useBlockDragDrop({ blockStore, onDragEnd })

      const container = makeContainer()
      const a = makeBlockEl('A', ROW(100), container)
      const b = makeBlockEl('B', ROW(130), container)
      makeBlockEl('C', ROW(160), container)

      // 指针停在 B 行下半区（130..160 的中心是 145）→ sort-after B
      stubElementFromPoint(b)
      const pointerMove = startDrag(hook.handleDragStart, a)
      pointerMove({ clientX: 300, clientY: 145 })

      hook.handleBlockDragEnd()
      expect(onDragEnd).toHaveBeenCalledWith({
        draggedId: 'A',
        target: { action: 'sort', toParentId: null, beforeId: 'C' }
      })

      // 意图落到树上 → A 移到 B 之后、C 之前
      const tree = [makeNode('A'), makeNode('B'), makeNode('C')]
      const intent = onDragEnd.mock.calls[0][0] as DragEndIntent
      applyDropTarget(tree, intent.draggedId, intent.target)
      expect(tree.map(n => n.id)).toEqual(['B', 'A', 'C'])
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
  })

  /**
   * 回归：向下拖时落点曾恒偏上一个。
   *
   * Sortable 只在「决定换位」的瞬间派发 @move，而被拖元素换位后必然压在指针下方
   * （ghost 跟随指针），Sortable 对它 early-return 不再派发 —— 最后的采样于是永远是
   * 「指针刚进目标上半区」的判定。意图改由 pointermove 驱动后，指针压在被拖元素上时
   * 退回同容器内最近的兄弟块，落位即 Sortable 摆好的槽位（用户看到的虚线占位）。
   */
  describe('指针压在被拖元素上（向下拖的回归）', () => {
    it('退回同容器最近的兄弟块 → 保持 Sortable 摆好的槽位，不偏上一个', () => {
      const blockStore = useBlockStore()
      const onDragEnd = vi.fn()
      const hook = useBlockDragDrop({ blockStore, onDragEnd })

      // 向下拖 A：Sortable 已把 A 换到 B 之后 → DOM [B, A]，指针停在 A 的占位行（130..160）上
      const container = makeContainer()
      makeBlockEl('B', ROW(100), container)
      const a = makeBlockEl('A', ROW(130), container)
      makeBlockEl('A', ROW(130), container, 'block block-drag') // fallback 克隆，不是合法目标

      stubElementFromPoint(a) // 指针命中的是被拖元素自己
      const pointerMove = startDrag(hook.handleDragStart, a)
      pointerMove({ clientX: 300, clientY: 145 })

      expect(hook.indicatorVisible.value).toBe(true)
      expect(hook.indicatorClass.value).toBe('sort')
      // 指示线锚在真正的插入口（被拖元素自己的行顶 = 虚线占位处），而不是目标行顶部
      expect(hook.indicatorStyle.value.top).toBe('130px')

      hook.handleBlockDragEnd()
      const intent = onDragEnd.mock.calls[0][0] as DragEndIntent
      expect(intent.draggedId).toBe('A')
      // B 的下一块就是 A 自己 → 语义是「插到自己前面」，即原地不动
      expect(intent.target).toEqual({ action: 'sort', toParentId: null, beforeId: 'A' })

      const tree = [makeNode('B'), makeNode('A')]
      applyDropTarget(tree, intent.draggedId, intent.target)
      expect(tree.map(n => n.id)).toEqual(['B', 'A'])
    })

    it('向上拖是对称的（原本就正常的那一侧不回退）', () => {
      const blockStore = useBlockStore()
      const onDragEnd = vi.fn()
      const hook = useBlockDragDrop({ blockStore, onDragEnd })

      // 向上拖 B：Sortable 把 B 换到 A 之前 → DOM [B, A]，指针停在 B 的占位行上
      const container = makeContainer()
      const b = makeBlockEl('B', ROW(100), container)
      makeBlockEl('A', ROW(130), container)

      stubElementFromPoint(b)
      const pointerMove = startDrag(hook.handleDragStart, b)
      pointerMove({ clientX: 300, clientY: 115 })

      hook.handleBlockDragEnd()
      const intent = onDragEnd.mock.calls[0][0] as DragEndIntent
      expect(intent.target).toEqual({ action: 'sort', toParentId: null, beforeId: 'A' })

      const tree = [makeNode('B'), makeNode('A')]
      applyDropTarget(tree, intent.draggedId, intent.target)
      expect(tree.map(n => n.id)).toEqual(['B', 'A'])
    })

    it('指针没命中任何块（落在容器空白）时也用最近的兄弟块，不留丢意图', () => {
      const blockStore = useBlockStore()
      const onDragEnd = vi.fn()
      const hook = useBlockDragDrop({ blockStore, onDragEnd })

      const container = makeContainer()
      makeBlockEl('B', ROW(100), container)
      const a = makeBlockEl('A', ROW(130), container)

      stubElementFromPoint(null)
      const pointerMove = startDrag(hook.handleDragStart, a)
      pointerMove({ clientX: 300, clientY: 145 })

      expect(hook.indicatorVisible.value).toBe(true)

      hook.handleBlockDragEnd()
      const intent = onDragEnd.mock.calls[0][0] as DragEndIntent
      expect(intent.target).toEqual({ action: 'sort', toParentId: null, beforeId: 'A' })
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
      rowRect: bulletRect,
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

  it('真实 20px bullet 下中区为空集，改用行矩形基准后中区可达', () => {
    // 真机实测：bullet 宽 20px、.block-row 宽约 400px。
    // 用 bullet 作基准时 left 阈(115) 与 right 阈(left+5) 交叉 → 中区为空，
    // 同一光标位置只能落进右区，sort-after 无法用手势表达。
    const narrowBullet = { left: 100, right: 120, top: 100, height: 30 }
    const wideRow = { left: 100, right: 500, top: 100, height: 30 }

    expect(
      resolveDropAction({ x: 300, y: 110 }, geometry({ bulletRect: narrowBullet, rowRect: narrowBullet }))?.action
    ).toBe('nest')

    expect(resolveDropAction({ x: 300, y: 110 }, geometry({ bulletRect: narrowBullet, rowRect: wideRow }))).toEqual({
      action: 'sort',
      toParentId: 'b1',
      beforeId: 'b2'
    })

    // 行右端 15px 内才是 nest
    expect(
      resolveDropAction({ x: 490, y: 110 }, geometry({ bulletRect: narrowBullet, rowRect: wideRow }))?.action
    ).toBe('nest')
  })

  it('缺省 rowRect 时退回 bulletRect 基准', () => {
    expect(
      resolveDropAction(
        { x: 300, y: 110 },
        { blockId: 'b2', parentId: 'b1', nextSiblingId: null, bulletRect: { left: 100, right: 120, top: 100, height: 30 } }
      )?.action
    ).toBe('nest')
  })
})
