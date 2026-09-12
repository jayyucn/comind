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
      pointerMove({ clientX: 100, clientY: 145 })

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
      pointerMove({ clientX: 100, clientY: 145 })

      expect(hook.indicatorVisible.value).toBe(true)
      expect(hook.indicatorClass.value).toBe('')
      // 统一槽位：横线在同级内容列（bullet 左缘 100），纵向锚在真正的插入口
      // （被拖元素自己的行顶 = 虚线占位处），而不是目标行顶部
      expect(hook.indicatorStyle.value.left).toBe('100px')
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
      pointerMove({ clientX: 100, clientY: 115 })

      hook.handleBlockDragEnd()
      const intent = onDragEnd.mock.calls[0][0] as DragEndIntent
      expect(intent.target).toEqual({ action: 'sort', toParentId: null, beforeId: 'A' })

      const tree = [makeNode('B'), makeNode('A')]
      applyDropTarget(tree, intent.draggedId, intent.target)
      expect(tree.map(n => n.id)).toEqual(['B', 'A'])
    })

    it('流动中的 ghost 不参与 beforeId 解析（几何基于「抽掉被拖块的树」）', () => {
      const blockStore = useBlockStore()
      const onDragEnd = vi.fn()
      const hook = useBlockDragDrop({ blockStore, onDragEnd })

      // Sortable 已把被拖的 A 换到 B、C 之间（ghost 在 DOM 中流动）
      const container = makeContainer()
      makeBlockEl('B', ROW(100), container)
      const a = makeBlockEl('A', ROW(130), container, 'block block-ghost')
      makeBlockEl('C', ROW(160), container)

      // 指针在 B 行下半 → sort-after B：锚点应跳过 ghost A，取到真实的 C
      stubElementFromPoint(container.querySelector('[data-block-id="B"]'))
      const pointerMove = startDrag(hook.handleDragStart, a)
      pointerMove({ clientX: 100, clientY: 120 })

      hook.handleBlockDragEnd()
      const intent = onDragEnd.mock.calls[0][0] as DragEndIntent
      expect(intent.target).toEqual({ action: 'sort', toParentId: null, beforeId: 'C' })
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
      pointerMove({ clientX: 100, clientY: 145 })

      expect(hook.indicatorVisible.value).toBe(true)

      hook.handleBlockDragEnd()
      const intent = onDragEnd.mock.calls[0][0] as DragEndIntent
      expect(intent.target).toEqual({ action: 'sort', toParentId: null, beforeId: 'A' })
    })
  })

  /**
   * 三层嵌套假块：block 自身矩形是 border-box（含整棵子树），row 是单行矩形，
   * bullet 每级向右缩进 44。模拟真实 .block 几何。
   */
  function makeTreeBlock(
    id: string,
    rects: { box: FakeRect; rowTop: number; bulletLeft: number },
    mount: HTMLElement
  ): { el: HTMLElement; children: HTMLElement } {
    const el = document.createElement('div')
    el.className = 'block'
    el.dataset.blockId = id
    el.getBoundingClientRect = () => {
      const isCollapsed = el
        .querySelector('.block-bullet')
        ?.classList.contains('collapsed')
      return (isCollapsed ? { ...rects.box, bottom: rects.rowTop + 30 } : rects.box) as unknown as DOMRect
    }
    const row = document.createElement('div')
    row.className = 'block-row'
    row.getBoundingClientRect = () => ROW(rects.rowTop)
    const bullet = document.createElement('div')
    bullet.className = 'block-bullet'
    bullet.getBoundingClientRect = () =>
      ({ left: rects.bulletLeft, right: rects.bulletLeft + 50, top: rects.rowTop + 3, bottom: rects.rowTop + 27, width: 50, height: 24 }) as unknown as DOMRect
    const children = document.createElement('div')
    children.className = 'block-children'
    children.dataset.parentId = id
    el.append(row, bullet, children)
    mount.appendChild(el)
    return { el, children }
  }

  /**
   * 回归：子容器左 padding / 子块 indent 空白处 elementFromPoint 命中祖先块
   * （.block 盒包含整棵子树），曾使子块 promote 左列只有 2px 可命中。
   * refineTargetByBand 按「光标列 × y 所在最深后代」修正目标。
   */
  describe('目标精化：命中祖先 padding 时按列条带下钻', () => {
    // G(bullet 100, 行 100..130, 盒到 190) > P(bullet 144, 行 130..160, 盒到 190) > C(bullet 188, 行 160..190)
    function buildTree() {
      const root = makeContainer()
      const g = makeTreeBlock('G', { box: { ...ROW(100), bottom: 190 }, rowTop: 100, bulletLeft: 100 }, root)
      const p = makeTreeBlock('P', { box: { ...ROW(130), bottom: 190 }, rowTop: 130, bulletLeft: 144 }, g.children)
      const c = makeTreeBlock('C', { box: ROW(160), rowTop: 160, bulletLeft: 188 }, p.children)
      const dragged = makeBlockEl('D', ROW(220), root)
      return { root, g: g.el, p: p.el, c: c.el, dragged }
    }

    it('孙块行 × 祖父列：目标解析为 P，指示槽位画在祖父列（promote P）', () => {
      const blockStore = useBlockStore()
      const onDragEnd = vi.fn()
      const hook = useBlockDragDrop({ blockStore, onDragEnd })
      const { g, dragged } = buildTree()

      stubElementFromPoint(g) // 指针在 G 子容器左 padding（292..312 那种区）
      const pointerMove = startDrag(hook.handleDragStart, dragged)
      pointerMove({ clientX: 100, clientY: 175 })

      // 没有下钻到 P 之外（C 的条带左缘 = 188−44 = 144，x=100 不覆盖）
      expect(hook.indicatorStyle.value.left).toBe('100px') // P bullet 144 −44

      hook.handleBlockDragEnd()
      const intent = onDragEnd.mock.calls[0][0] as DragEndIntent
      // P 提升到 G 之后：G 的下一兄弟是 D
      expect(intent.target).toEqual({ action: 'promote', toParentId: null, beforeId: 'D' })
    })

    it('孙块行 × 父列：穿过中间层解析到 C，槽位画父列（promote C）', () => {
      const blockStore = useBlockStore()
      const onDragEnd = vi.fn()
      const hook = useBlockDragDrop({ blockStore, onDragEnd })
      const { g, dragged } = buildTree()

      stubElementFromPoint(g)
      const pointerMove = startDrag(hook.handleDragStart, dragged)
      pointerMove({ clientX: 144, clientY: 175 })

      expect(hook.indicatorStyle.value.left).toBe('144px') // C bullet 188 −44

      hook.handleBlockDragEnd()
      const intent = onDragEnd.mock.calls[0][0] as DragEndIntent
      // C 的父是 P、祖父是 G；P 无下一兄弟 → 追加到 G 容器末尾
      expect(intent.target).toEqual({ action: 'promote', toParentId: 'G', beforeId: null })
    })

    it('光标列在条带左缘之外 → 停在祖先块（根级左列钳制为 sort）', () => {
      const blockStore = useBlockStore()
      const onDragEnd = vi.fn()
      const hook = useBlockDragDrop({ blockStore, onDragEnd })
      const { g, dragged } = buildTree()

      stubElementFromPoint(g)
      const pointerMove = startDrag(hook.handleDragStart, dragged)
      pointerMove({ clientX: 55, clientY: 175 }) // < G bullet 100−44=56
      hook.handleBlockDragEnd()
      const intent = onDragEnd.mock.calls[0][0] as DragEndIntent
      expect(intent.target).toEqual({ action: 'sort', toParentId: null, beforeId: 'D' })
    })

    it('折叠的中间层不下钻', () => {
      const blockStore = useBlockStore()
      const onDragEnd = vi.fn()
      const hook = useBlockDragDrop({ blockStore, onDragEnd })
      const { g, p, dragged } = buildTree()
      p.querySelector('.block-bullet')!.classList.add('collapsed')

      stubElementFromPoint(g)
      const pointerMove = startDrag(hook.handleDragStart, dragged)
      pointerMove({ clientX: 100, clientY: 175 }) // 折叠后 P 盒收缩到 130..160，停在 G（中列 → sort）
      hook.handleBlockDragEnd()
      const intent = onDragEnd.mock.calls[0][0] as DragEndIntent
      expect(intent.target).toEqual({ action: 'sort', toParentId: null, beforeId: 'D' })
    })
  })

  describe('Esc 取消拖拽', () => {
    it('回滚：DOM 插回原槽位，@end 回传「写回原槽位」的 sort 意图', () => {
      const blockStore = useBlockStore()
      const onDragEnd = vi.fn()
      const hook = useBlockDragDrop({ blockStore, onDragEnd })

      const container = makeContainer()
      const a = makeBlockEl('A', ROW(100), container)
      makeBlockEl('B', ROW(130), container)
      makeBlockEl('C', ROW(160), container)

      const bEl = container.querySelector('[data-block-id="B"]') as HTMLElement
      stubElementFromPoint(bEl)
      const pointerMove = startDrag(hook.handleDragStart, a)
      pointerMove({ clientX: 100, clientY: 145 })
      expect(hook.indicatorVisible.value).toBe(true)

      // 模拟 Sortable 换位：被拖元素在 DOM 中被移到末尾
      container.appendChild(a)

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      expect(hook.indicatorVisible.value).toBe(false)
      // 1) DOM 已被插回原槽位
      expect(Array.from(container.children).map(e => (e as HTMLElement).dataset.blockId)).toEqual([
        'A',
        'B',
        'C'
      ])

      hook.handleBlockDragEnd()
      // 2) @end 回传的不是 null（vue-draggable-plus 仍会强制 splice 数组），
      //    而是写回原槽位的 sort 意图，经 applyDropTarget 校正后树恢复原序
      const intent = onDragEnd.mock.calls[0][0] as DragEndIntent
      expect(intent).toEqual({ draggedId: 'A', target: { action: 'sort', toParentId: null, beforeId: 'B' } })
      const tree = [makeNode('B'), makeNode('A'), makeNode('C')]
      applyDropTarget(tree, intent.draggedId, intent.target)
      expect(tree.map(n => n.id)).toEqual(['A', 'B', 'C'])
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

describe('resolveDropAction（间隙 × 深度刻度矩阵）', () => {
  // bullet x 100..150、y 100..130；刻度 44 → 中列 [78,122)、右列 ≥122、左列 ≤78；y 中线 115
  const bulletRect = { left: 100, right: 150, top: 100, height: 30 }

  function geometry(overrides: Partial<DropTargetGeometry> = {}): DropTargetGeometry {
    return {
      blockId: 'b2',
      parentId: 'b1',
      grandparentId: 'g1',
      nextSiblingId: 'b3',
      parentNextSiblingId: 'b4',
      firstChildId: 'b2c1',
      bulletRect,
      ...overrides
    }
  }

  it('returns null when the target block has no bullet', () => {
    expect(resolveDropAction({ x: 100, y: 110 }, geometry({ bulletRect: null }))).toBeNull()
  })

  it('returns null when the target block has no id', () => {
    expect(resolveDropAction({ x: 100, y: 110 }, geometry({ blockId: null }))).toBeNull()
  })

  it('中列上半区 → sort 到目标之前', () => {
    expect(resolveDropAction({ x: 100, y: 110 }, geometry())).toEqual({
      action: 'sort',
      toParentId: 'b1',
      beforeId: 'b2'
    })
  })

  it('中列下半区 → sort 到下一兄弟之前', () => {
    expect(resolveDropAction({ x: 100, y: 120 }, geometry())).toEqual({
      action: 'sort',
      toParentId: 'b1',
      beforeId: 'b3'
    })
  })

  it('中列下半区且无下一兄弟 → 追加到同级末尾', () => {
    expect(resolveDropAction({ x: 100, y: 120 }, geometry({ nextSiblingId: null }))).toEqual({
      action: 'sort',
      toParentId: 'b1',
      beforeId: null
    })
  })

  it('右列上半区 → nest 到长子位（beforeId = 长子）', () => {
    expect(resolveDropAction({ x: 130, y: 110 }, geometry())).toEqual({
      action: 'nest',
      toParentId: 'b2',
      beforeId: 'b2c1'
    })
  })

  it('右列下半区 → nest 到子级末尾', () => {
    expect(resolveDropAction({ x: 130, y: 120 }, geometry())).toEqual({
      action: 'nest',
      toParentId: 'b2',
      beforeId: null
    })
  })

  it('右列上半区但目标无子 → beforeId 为 null（空 children 追加）', () => {
    expect(resolveDropAction({ x: 130, y: 110 }, geometry({ firstChildId: null }))).toEqual({
      action: 'nest',
      toParentId: 'b2',
      beforeId: null
    })
  })

  it('左列上半区 → promote 到祖父容器、父块之前', () => {
    expect(resolveDropAction({ x: 70, y: 110 }, geometry())).toEqual({
      action: 'promote',
      toParentId: 'g1',
      beforeId: 'b1'
    })
  })

  it('左列下半区 → promote 到父块的下一兄弟之前（父块之后）', () => {
    expect(resolveDropAction({ x: 70, y: 120 }, geometry())).toEqual({
      action: 'promote',
      toParentId: 'g1',
      beforeId: 'b4'
    })
  })

  it('左列下半区且父块无下一兄弟 → 追加到祖父容器末尾', () => {
    expect(resolveDropAction({ x: 70, y: 120 }, geometry({ parentNextSiblingId: null }))).toEqual({
      action: 'promote',
      toParentId: 'g1',
      beforeId: null
    })
  })

  it('根级行的左列钳制为同级 sort（无可提升处）', () => {
    expect(resolveDropAction({ x: 70, y: 110 }, geometry({ parentId: null, grandparentId: null }))).toEqual({
      action: 'sort',
      toParentId: null,
      beforeId: 'b2'
    })
    expect(resolveDropAction({ x: 70, y: 120 }, geometry({
      parentId: null,
      grandparentId: null,
      nextSiblingId: 'b3'
    }))).toEqual({
      action: 'sort',
      toParentId: null,
      beforeId: 'b3'
    })
  })

  it('半刻度边界：+22 降级、−22 提升，±21 仍同级', () => {
    expect(resolveDropAction({ x: 122, y: 110 }, geometry())?.action).toBe('nest')
    expect(resolveDropAction({ x: 121, y: 110 }, geometry())?.action).toBe('sort')
    expect(resolveDropAction({ x: 78, y: 110 }, geometry())?.action).toBe('promote')
    expect(resolveDropAction({ x: 79, y: 110 }, geometry())?.action).toBe('sort')
  })

  it('跨多列只切一级（多级切换本轮不启用）', () => {
    expect(resolveDropAction({ x: 200, y: 110 }, geometry())?.action).toBe('nest')
    expect(resolveDropAction({ x: 0, y: 110 }, geometry())?.action).toBe('promote')
  })
})
