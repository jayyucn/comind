import { getCurrentInstance, onBeforeUnmount, ref } from 'vue'
import type { DragRect } from '../../../composables/useDragDrop'
import { computeDepthDelta, computeSortPosition } from '../../../composables/useDragDrop'
import type { useBlockStore } from '../../../stores/blocks'
import type { TreeNode } from '../../../types/block'
import { isDescendantOf } from '../../../utils/block-helpers'

/**
 * 一级缩进总宽（px）= `.block-children` 的 `padding-left`(20) + Block/index.vue 的
 * `INDENT_WIDTH_PER_LEVEL`(24)。既是深度判定的量化刻度，也是指示槽位的缩进量。
 * 改其中任一处，此常量必须同步。
 *
 * 不要用目标块的 `depth` 参与计算：bullet 的 x 已包含行内 `.block-indent` 的累计
 * 缩进，再乘层级会把缩进算两遍（详见 docs/sort/sortable-implementation.md §9）。
 */
const INDENT_TOTAL_PER_LEVEL = 44

/**
 * 放置目标类型
 *
 * - sort: 同级排序（beforeId 指定插入到哪个 block 之前；null 表示追加到末尾）
 * - nest: 嵌套为目标 block 的子节点（beforeId 为长子 id = 长子位；null = 末尾追加）
 * - promote: 提升到祖父容器（beforeId 为父块 id = 父块之前；为父块的下一兄弟 id
 *   = 父块之后；null = 追加到祖父容器末尾）
 */
export type DropAction = 'sort' | 'nest' | 'promote' | null

export interface DropTarget {
  action: DropAction
  toParentId: string | null
  beforeId: string | null
}

/** 放置判定的输入：目标块的可测元数据（纯数据，不含 DOM 引用） */
export interface DropTargetGeometry {
  /** 目标块 T 的 blockId */
  blockId: string | null
  /** T 的父块 id（sort 的归属父级；根级为 null） */
  parentId: string | null
  /** T 父块的父块 id（promote 的归属父级；父块在根级时为 null） */
  grandparentId: string | null
  /** T 在同级的下一块 id（sort-after 的 beforeId；null 表示追加到末尾） */
  nextSiblingId: string | null
  /** T 父块的下一同级兄弟 id（promote-after 的 beforeId；null 表示追加到祖父末尾） */
  parentNextSiblingId: string | null
  /** T 的长子 id（nest-before 的 beforeId；null 表示 T 无子） */
  firstChildId: string | null
  /** 目标块 bullet 的矩形；null 表示无 bullet，不可作为放置目标 */
  bulletRect: DragRect | null
}

/**
 * 放置判定核心（纯函数）：由光标位置 + 目标块元数据解出放置语义。
 *
 * 两个正交维度（「间隙 × 深度刻度」模型）：
 * - Y 相对目标行中线分上/下半区，决定插入间隙（before / after）；
 * - X 相对目标 bullet 左缘按 INDENT_TOTAL_PER_LEVEL 刻度量化为 −1/0/+1 三列。
 *
 * 六格矩阵：
 * ```
 *        左列(−1)            中列(0)      右列(+1)
 * 上半  P 之前 / promote    T 之前 sort   T 长子位 / nest
 * 下半  P 之后 / promote    T 之后 sort   T 末尾子位 / nest
 * ```
 * 根级行的 −1 列钳制为同级 sort（根级无可提升处）。
 * 无 DOM 依赖，可直接单测。
 */
export function resolveDropAction(
  cursor: { x: number; y: number },
  geometry: DropTargetGeometry
): DropTarget | null {
  const {
    bulletRect,
    blockId,
    parentId,
    grandparentId,
    nextSiblingId,
    parentNextSiblingId,
    firstChildId
  } = geometry
  if (!bulletRect || !blockId) return null

  const delta = computeDepthDelta(cursor.x, bulletRect.left, INDENT_TOTAL_PER_LEVEL)
  const before = computeSortPosition(cursor.y, bulletRect) === 'before'

  // 右列：成为 T 的子节点。上半区 → 长子位（firstChildId 为锚点；无子时 null = 追加）
  if (delta === 1) {
    return { action: 'nest', toParentId: blockId, beforeId: before ? firstChildId : null }
  }

  // 左列且 T 不在根级：提升到祖父容器。beforeId = 父块（父块之前）/ 父块下一兄弟（父块之后）
  if (delta === -1 && parentId) {
    return {
      action: 'promote',
      toParentId: grandparentId,
      beforeId: before ? parentId : parentNextSiblingId
    }
  }

  // 中列（含根级 −1 列钳制）：同级排序
  return {
    action: 'sort',
    toParentId: parentId,
    beforeId: before ? blockId : nextSiblingId
  }
}

/** 拖拽结束时的落位意图：被拖块 id + 最后一次 @move 判定出的目标 */
export interface DragEndIntent {
  draggedId: string
  target: DropTarget
}

/** 在树中定位节点所在容器（用于摘除与合法性校验） */
function locate(
  list: TreeNode[],
  id: string
): { list: TreeNode[]; index: number; node: TreeNode } | null {
  for (let i = 0; i < list.length; i++) {
    const node = list[i]
    if (node.id === id) return { list, index: i, node }
    const inner = locate(node.children, id)
    if (inner) return inner
  }
  return null
}

/** 目标父节点的 children 列表（toParentId 为 null 时即根列表） */
function resolveParentList(tree: TreeNode[], toParentId: string | null): TreeNode[] | null {
  if (toParentId === null) return tree
  return locate(tree, toParentId)?.node.children ?? null
}

/**
 * 按落位意图重排树（纯函数）。
 *
 * Sortable 自身只做「同级重排 + 相邻容器吸附」，落位与 resolveDropAction 的判定
 * 并不一致（右区画 nest 线却落成 sort）。此函数在 @end 后把 Sortable 的结果纠正为
 * 意图结果：摘下 draggedId，插入 target 指定的位置。
 *
 * @returns 是否发生了实际移动（未移动时调用方无需额外处理）
 */
export function applyDropTarget(tree: TreeNode[], draggedId: string, target: DropTarget): boolean {
  if (!target.action) return false
  // 目标位置即自身当前位置（sort-after 时 nextSibling 恰为被拖块自身）→ 无需校正
  if (target.toParentId === draggedId || target.beforeId === draggedId) return false

  const source = locate(tree, draggedId)
  if (!source) return false
  // 禁止移入自身子树
  if (target.toParentId && locate(source.node.children, target.toParentId)) return false
  if (target.beforeId && locate(source.node.children, target.beforeId)) return false

  const dest = resolveParentList(tree, target.toParentId)
  if (!dest) return false

  source.list.splice(source.index, 1)
  // 摘除后再定位 beforeId，索引才与目标列表当前状态一致
  const at = target.beforeId ? dest.findIndex(n => n.id === target.beforeId) : -1
  if (at === -1) dest.push(source.node)
  else dest.splice(at, 0, source.node)
  return true
}

interface UseBlockDragDropOptions {
  blockStore: ReturnType<typeof useBlockStore>
  /**
   * 拖拽结束回调：回传本次拖拽的落位意图（无有效意图时为 null）。
   * 调用方按意图校正树后再落库（syncTreeToStore 完整树 diff）。
   */
  onDragEnd?: (intent: DragEndIntent | null) => void
}

/**
 * useBlockDragDrop — block 拖放逻辑 composable（<BlockDraggableList> 内部使用）
 *
 * - resolveDropAction: 放置判定核心（纯函数，无 DOM 依赖，可单测）
 * - resolveTargetBlock: 指针 → 目标块（本模块唯一用 elementFromPoint 的地方）
 * - handleDragStart: VueDraggable @start 处理器，接管拖拽期指针跟踪
 * - handleDragMove: VueDraggable @move 处理器，只做循环嵌套守卫
 * - handleBlockDragEnd: VueDraggable @end 处理器，回传落位意图并触发 onDragEnd
 * - renderDropIndicator / clearIndicator: 通过响应式 ref 驱动 <BlockDropIndicator>
 *
 * 落位意图由拖拽期间的 pointermove 持续重算，**不用 Sortable 的 @move 采样**：
 * @move 只在「Sortable 决定换位」的那一瞬派发，而被拖元素随即被移到指针下方并挡住指针，
 * Sortable 对它 early-return（`dragEl.contains(evt.target)`）不再派发 —— 于是最后一个采样
 * 恒是「指针刚进目标上半区」的判定，表现为「从上往下拖，落点偏上一个」。
 *
 * 落库职责（单一写路径）：handleBlockDragEnd 只回传意图 + 触发 onDragEnd。
 * 调用方先按意图校正树（applyDropTarget），再走 syncTreeToStore（完整树 diff）
 * ——主编辑器、弹窗、子级列表同源。
 *
 * 指示器状态为模块级共享 ref：所有拖拽列表共用一个指示器，
 * 由 BlockList 通过 useSharedDropIndicator() 渲染单个 <BlockDropIndicator>。
 *
 * 注意：handleDragMove 必须保留 boolean 返回值（false 阻止非法移动），
 * 由 <BlockDraggableList> 直接绑到 VueDraggable 的 @move。
 */

// ── 模块级共享指示器状态 ──────────────────────────────────────────────
// 所有 Block 实例共享同一组 ref，复现原全局 .drop-indicator DOM 元素行为：
// 任意时刻只有一个指示器，无论哪个 Block 的 handleDragMove 触发。
const sharedIndicatorStyle = ref<Record<string, string>>({})
const sharedIndicatorClass = ref<string>('')
const sharedIndicatorVisible = ref(false)

/**
 * useSharedDropIndicator — 暴露模块级共享指示器 ref。
 *
 * 由 BlockList（或任何单一消费者）调用，渲染一个 <BlockDropIndicator>，
 * 而非每个 Block 实例各渲染一个。匹配原实现中单个全局 .drop-indicator 元素的行为。
 */
export function useSharedDropIndicator() {
  return {
    style: sharedIndicatorStyle,
    cssClass: sharedIndicatorClass,
    visible: sharedIndicatorVisible
  }
}

export function useBlockDragDrop(options: UseBlockDragDropOptions) {
  const { blockStore, onDragEnd } = options

  /** 本次拖拽的被拖元素（Sortable 会给它加 ghost-class，并把它移到指针所在位置挡住指针） */
  let draggedEl: HTMLElement | null = null
  /** 落位意图：拖拽期间随指针持续重算，@end 时消费 */
  let pendingIntent: DropTarget | null = null
  let pendingDraggedId: string | null = null
  /** Esc 取消时的回滚意图：把被拖块写回拖拽前的槽位（见 handleDocumentKeyDown） */
  let pendingRevert: DragEndIntent | null = null
  /** 拖拽开始时的原父容器 / 原下一兄弟：Esc 取消时把被拖元素插回原位 */
  let originalParent: HTMLElement | null = null
  let originalNextSibling: Element | null = null
  /** 上一次指针位置：pointermove 高频，位置没变就不重算（避免无谓的 DOM 读取与响应式写入） */
  let lastPointerX = Number.NaN
  let lastPointerY = Number.NaN

  // ── 指示器响应式状态（模块级共享，所有 Block 实例共用）──
  const indicatorStyle = sharedIndicatorStyle
  const indicatorClass = sharedIndicatorClass
  const indicatorVisible = sharedIndicatorVisible

  /** 目标块整行（.block-row）的矩形；找不到行元素时返回 null */
  function readRowRect(targetBlockEl: HTMLElement): DragRect | null {
    const row = targetBlockEl.querySelector('.block-row') as HTMLElement | null
    if (!row) return null
    const rect = row.getBoundingClientRect()
    return { left: rect.left, right: rect.right, top: rect.top, height: rect.height }
  }

  /** 块的直接子级拖拽容器（.block-children，BlockDraggableList 根元素） */
  function readChildContainer(targetBlockEl: HTMLElement): HTMLElement | null {
    return targetBlockEl.querySelector(':scope > .block-children')
  }

  /** 容器内第一个 / 最后一个 .block 子项（跳过 Sortable 临时元素与被拖块自身的流动 ghost） */
  function isStationaryBlock(el: Element | null): el is HTMLElement {
    return (
      !!el &&
      el.classList.contains('block') &&
      !el.classList.contains('block-drag') &&
      !el.classList.contains('block-ghost')
    )
  }
  function firstBlockChild(container: HTMLElement): HTMLElement | null {
    for (const child of Array.from(container.children) as HTMLElement[]) {
      if (isStationaryBlock(child)) return child
    }
    return null
  }
  function lastBlockChild(container: HTMLElement): HTMLElement | null {
    const children = Array.from(container.children) as HTMLElement[]
    for (let i = children.length - 1; i >= 0; i--) {
      if (isStationaryBlock(children[i])) return children[i]
    }
    return null
  }

  /**
   * 从 el 起向后找第一个「静止的」块级兄弟并取其 id。
   * 拖拽中被拖元素（.block-ghost）在 DOM 里流动换位，矩阵的 beforeId 必须基于
   * 「抽掉被拖块后的树」，否则会取到 ghost 自己、槽位线画在流动的 ghost 位置上。
   */
  function siblingBlockId(el: Element | null): string | null {
    let cur = el
    while (cur) {
      if (isStationaryBlock(cur)) return cur.dataset.blockId ?? null
      cur = cur.nextElementSibling
    }
    return null
  }

  /**
   * 锚点块（`beforeId`）所在行的矩形 —— sort 指示线要画在真正的插入口上。
   *
   * 判定出的 `beforeId` 不一定是「指针下那块」：中区下半区会指向目标的下一块，
   * 指针压在被拖元素上时指向被拖元素自己。线若一律画在目标行顶部，就会比落位高一行
   * （真机实测：向下拖到底时线停在 EE 之上，实际却落在 EE 之后）。
   *
   * 跳过 Sortable 的 fallback 克隆（.block-drag，与被拖元素同 id），保留被拖元素本身 ——
   * 它的槽位正是「插到自己之前」的落点。
   */
  function readAnchorRowRect(targetBlockEl: HTMLElement, beforeId: string): DragRect | null {
    const container = targetBlockEl.parentElement
    if (!container) return null
    for (const child of Array.from(container.children) as HTMLElement[]) {
      if (child.classList.contains('block-drag') || child.dataset.blockId !== beforeId) continue
      return readRowRect(child)
    }
    return null
  }

  /** 从 DOM 读取放置判定所需的元数据（本模块唯一接触 DOM 的入口） */
  function readDropGeometry(targetBlockEl: HTMLElement): DropTargetGeometry {
    const bullet = targetBlockEl.querySelector('.block-bullet') as HTMLElement | null
    // T 的父块：向上经过 .block-children 容器命中；祖父再向上一层
    const parentBlock = targetBlockEl.parentElement?.closest('.block') as HTMLElement | null
    const grandparentBlock = parentBlock?.parentElement?.closest('.block') as HTMLElement | null
    const childContainer = readChildContainer(targetBlockEl)
    return {
      blockId: targetBlockEl.dataset.blockId ?? null,
      parentId: parentBlock?.dataset.blockId ?? null,
      grandparentId: grandparentBlock?.dataset.blockId ?? null,
      nextSiblingId: siblingBlockId(targetBlockEl.nextElementSibling),
      parentNextSiblingId: siblingBlockId(parentBlock?.nextElementSibling ?? null),
      firstChildId: childContainer ? siblingBlockId(firstBlockChild(childContainer)) : null,
      bulletRect: bullet ? bullet.getBoundingClientRect() : null
    }
  }

  /**
   * 根据光标位置计算放置目标（DOM 适配层）
   *
   * 判定逻辑见纯函数 resolveDropAction；此处只负责读出 DOM 元数据。
   */
  function findDropTarget(
    cursorX: number,
    cursorY: number,
    targetBlockEl: HTMLElement
  ): DropTarget | null {
    return resolveDropAction({ x: cursorX, y: cursorY }, readDropGeometry(targetBlockEl))
  }

  /**
   * 被拖元素所在容器内、离指针垂直距离最近的兄弟块（排除被拖元素自己与 Sortable 的 fallback 克隆）。
   */
  function pickNearestSiblingBlock(dragged: HTMLElement, cursorY: number): HTMLElement | null {
    const container = dragged.parentElement
    if (!container) return null

    let nearest: HTMLElement | null = null
    let nearestDistance = Number.POSITIVE_INFINITY
    for (const child of Array.from(container.children)) {
      const el = child as HTMLElement
      if (el === dragged || !el.classList.contains('block') || el.classList.contains('block-drag')) continue
      const row = el.querySelector('.block-row') as HTMLElement | null
      if (!row) continue
      const rect = row.getBoundingClientRect()
      const distance = cursorY < rect.top ? rect.top - cursorY : cursorY > rect.bottom ? cursorY - rect.bottom : 0
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearest = el
      }
    }
    return nearest
  }

  /**
   * 指针命中的目标块。
   *
   * 拖拽中 Sortable 会把被拖元素移到指针所在位置，于是被拖元素必然压在指针下方；
   * 而 Sortable 对「指针落在被拖元素上」直接 early-return，不会派发 @move。
   * 因此命中被拖元素（或其子树、或它移走后剩下的空白）时，退回同容器内离指针最近的兄弟块。
   */
  function resolveTargetBlock(cursorX: number, cursorY: number): HTMLElement | null {
    const hit = document.elementFromPoint(cursorX, cursorY)
    const rawBlock = (hit?.closest('.block') as HTMLElement | null) ?? null
    const blockedByDragged =
      !!rawBlock && !!draggedEl && (rawBlock === draggedEl || draggedEl.contains(rawBlock))
    const seed =
      rawBlock && !blockedByDragged
        ? rawBlock
        : draggedEl
          ? pickNearestSiblingBlock(draggedEl, cursorY)
          : null
    return seed ? refineTargetByBand(seed, cursorX, cursorY) : null
  }

  /**
   * 命中块精化：沿「光标 y 所在的最深后代」下钻。
   *
   * elementFromPoint 在子容器左 padding / 子块 indent 空白处命中的是祖先块
   * （.block 的盒包含整棵子树），于是子块 promote 左列（bullet 左移 22~44px）
   * 落在自己的 .block 盒之外，实际可命中宽度只有 2px。这里下钻时：
   * - 纵向用子块 border-box（含其整棵子树）判断，使隔层行（孙块行 × 父列 x）能逐层穿过；
   * - 横向把每层命中条带向左延伸一级（bullet.left − INDENT_TOTAL_PER_LEVEL）：
   *   光标停在哪一列，深度锚点就解析到「promote 条带覆盖该列」的最近祖先，
   *   delta 仍以该块 bullet 为锚点，自然为 −1。折叠块不下钻。
   */
  function refineTargetByBand(
    startBlock: HTMLElement,
    cursorX: number,
    cursorY: number
  ): HTMLElement {
    let current = startBlock
    for (;;) {
      const collapsed = current
        .querySelector('.block-bullet')
        ?.classList.contains('collapsed')
      const container = !collapsed ? readChildContainer(current) : null
      let deeper: HTMLElement | null = null
      if (container) {
        for (const child of Array.from(container.children) as HTMLElement[]) {
          if (!child.classList.contains('block') || child.classList.contains('block-drag') || child.classList.contains('block-ghost')) continue
          const box = child.getBoundingClientRect()
          const bulletRect = (
            child.querySelector('.block-bullet') as HTMLElement | null
          )?.getBoundingClientRect()
          if (!box || !bulletRect) continue
          if (
            cursorY >= box.top &&
            cursorY < box.bottom &&
            cursorX >= bulletRect.left - INDENT_TOTAL_PER_LEVEL
          ) {
            deeper = child
            break
          }
        }
      }
      if (!deeper) return current
      current = deeper
    }
  }

  /** 按指针位置重算落位意图并刷新指示器（拖拽期间唯一写入 pendingIntent 的地方） */
  function updateIntentFromPointer(cursorX: number, cursorY: number) {
    const draggedId = draggedEl?.dataset.blockId ?? null
    const targetBlock = draggedId ? resolveTargetBlock(cursorX, cursorY) : null
    const geometry = targetBlock ? readDropGeometry(targetBlock) : null
    const resolved =
      geometry && draggedId ? resolveDropAction({ x: cursorX, y: cursorY }, geometry) : null

    // 容器归属守卫：目标父级是被拖块自身或其子孙 → 循环嵌套，非法。
    // 统一检查判定结果的 toParentId（sort=父、nest=目标自身、promote=祖父），
    // 比旧实现只检查 geometry.parentId 多覆盖 nest 进 dragged 子孙、promote 进 dragged 深子树。
    // beforeId 不查：beforeId === draggedId 是合法的「插到自己之前 = 原地」no-op 意图。
    const illegalContainer =
      !!resolved?.toParentId && isDescendantOf(blockStore.blocks, resolved.toParentId, draggedId!)
    const dropTarget = resolved && !illegalContainer ? resolved : null

    pendingIntent = dropTarget
    pendingDraggedId = dropTarget ? draggedId : null

    if (!dropTarget || !targetBlock) clearIndicator()
    else renderDropIndicator(targetBlock, dropTarget)
  }

  /**
   * 拖拽期间的指针跟踪（落位意图的唯一数据源）。
   *
   * 位置未变则跳过：pointermove 频率可达每帧一次，而判定要读 elementFromPoint
   * 与多个 getBoundingClientRect（会触发样式重算），没必要重复算同一个点。
   */
  function handleDocumentPointerMove(e: PointerEvent) {
    if (!draggedEl || (e.clientX === lastPointerX && e.clientY === lastPointerY)) return
    lastPointerX = e.clientX
    lastPointerY = e.clientY
    updateIntentFromPointer(e.clientX, e.clientY)
  }

  /**
   * Esc 取消拖拽：放弃当前落位意图，改为生成「插回原槽位」的回滚意图。
   *
   * sortablejs 1.15 自身不处理 Esc；vue-draggable-plus 会在 @end 时按事件 index
   * 强制 splice 绑定的树数组（与 DOM 现状无关），拦不住。因此双管齐下：
   * 1. 先把 ghost（display:none，插回不引发布局跳动）恢复到原父容器的原槽位，
   *    使 Sortable 结束流程的 DOM 状态归位；
   * 2. 记录一个 sort 回滚意图，@end 经既有的 applyDropTarget 校正链路把被强制
   *    splice 的数组纠回原序，最终落库仍是原树。
   */
  function handleDocumentKeyDown(e: KeyboardEvent) {
    const sibOk = !!(originalNextSibling && originalNextSibling.parentElement === originalParent)
    document.documentElement.dataset.dbg = `esc:${e.key}:d=${!!draggedEl}:p=${!!originalParent}:sibOk=${sibOk}`
    if (e.key !== 'Escape' || !draggedEl || !originalParent) return
    pendingIntent = null
    clearIndicator()

    if (
      originalNextSibling &&
      originalNextSibling.parentElement === originalParent
    ) {
      originalParent.insertBefore(draggedEl, originalNextSibling)
    } else if (!originalNextSibling) {
      originalParent.appendChild(draggedEl)
    }

    const draggedId = draggedEl.dataset.blockId ?? null
    const rawParentId = originalParent.dataset.parentId
    const beforeId = originalNextSibling?.classList.contains('block')
      ? (originalNextSibling as HTMLElement).dataset.blockId ?? null
      : null
    if (draggedId) {
      pendingRevert = {
        draggedId,
        target: {
          action: 'sort',
          toParentId: rawParentId ? rawParentId : null,
          beforeId
        }
      }
    }
  }

  /** 停止指针跟踪并清空拖拽期状态（正常结束与组件卸载共用） */
  function stopPointerTracking() {
    document.removeEventListener('pointermove', handleDocumentPointerMove)
    document.removeEventListener('keydown', handleDocumentKeyDown)
    // 恢复 handleDragStart 里内联隐藏的被拖本体（Esc 回滚已把它插回原槽位）
    draggedEl?.style.removeProperty('display')
    draggedEl = null
    originalParent = null
    originalNextSibling = null
    lastPointerX = Number.NaN
    lastPointerY = Number.NaN
  }

  /**
   * 拖拽开始：记录被拖元素并接管指针跟踪（由 <BlockDraggableList> 绑到 VueDraggable 的 @start）。
   *
   * 被拖元素优先取自 Sortable 事件载荷（@start 的 info 带 targetEl/item），
   * 退回 ghost-class（Sortable 在派发 start 之前已给被拖元素加上该 class）。
   * 同时记下原槽位（父容器 + 下一兄弟），供 Esc 取消时插回。
   */
  function handleDragStart(evt: any) {
    const candidate = (evt?.targetEl ?? evt?.item ?? evt?.originalEvent?.target) as HTMLElement | undefined
    draggedEl =
      (candidate?.closest?.('.block') as HTMLElement | null) ??
      (document.querySelector('.block-ghost') as HTMLElement | null)

    originalParent = (draggedEl?.parentElement as HTMLElement | null) ?? null
    originalNextSibling = draggedEl?.nextElementSibling ?? null
    // Sortable 定位 body 跟手克隆前才测量本体几何（_dragStarted：加 ghost-class →
    // _appendGhost → 派发 @start），本体不能由 CSS 隐藏（display:none 会让克隆拿到
    // 零矩形、落在视口左上角）。@start 时克隆已生成，此刻再摘掉本体。
    draggedEl?.style.setProperty('display', 'none')
    lastPointerX = Number.NaN
    lastPointerY = Number.NaN
    pendingIntent = null
    pendingDraggedId = null
    pendingRevert = null
    document.addEventListener('pointermove', handleDocumentPointerMove)
    document.addEventListener('keydown', handleDocumentKeyDown)
  }

  /**
   * 块的「静止子树之底」：最后一个静止块级子项的整棵子树底；
   * 折叠或无子时退化为自身行底。拖拽中流动的 ghost 不计入，
   * 否则末尾槽位会被 ghost 临时撑高 / 压低。
   *
   * 六种「间隙 × 深度」的纵向锚点都画在真正的插入间隙上：有锚点块时取其行顶，
   * 「末尾追加」取宿主块的静止子树之底。返回 null 表示无法定位，调用方退回目标行顶。
   */
  function stationarySubtreeBottom(blockEl: HTMLElement): number {
    const row = readRowRect(blockEl)
    const rowBottom = row ? row.top + row.height : null
    const collapsed = blockEl
      .querySelector('.block-bullet')
      ?.classList.contains('collapsed')
    if (collapsed) return rowBottom ?? blockEl.getBoundingClientRect().bottom
    const container = readChildContainer(blockEl)
    const last = container ? lastBlockChild(container) : null
    if (last) return last.getBoundingClientRect().bottom
    return rowBottom ?? blockEl.getBoundingClientRect().bottom
  }

  function resolveSlotTop(targetBlockEl: HTMLElement, dropTarget: DropTarget): number | null {
    if (dropTarget.action === 'nest') {
      const collapsed = targetBlockEl
        .querySelector('.block-bullet')
        ?.classList.contains('collapsed')
      const childContainer = !collapsed ? readChildContainer(targetBlockEl) : null
      if (childContainer) {
        // 长子位 → 长子行顶；末尾子位 → 幼子整棵子树之底
        const anchor = dropTarget.beforeId
          ? firstBlockChild(childContainer)
          : lastBlockChild(childContainer)
        if (anchor) {
          if (dropTarget.beforeId) return readRowRect(anchor)?.top ?? null
          return anchor.getBoundingClientRect().bottom
        }
      }
      return stationarySubtreeBottom(targetBlockEl)
    }

    if (dropTarget.action === 'promote') {
      const parentBlock = targetBlockEl.parentElement?.closest('.block') as HTMLElement | null
      if (!parentBlock) return null
      if (dropTarget.beforeId === parentBlock.dataset.blockId) {
        // 父块之前 → 父块行顶
        return readRowRect(parentBlock)?.top ?? null
      }
      if (dropTarget.beforeId) {
        // 父块之后 → 父块下一兄弟（叔叔）行顶；跳过流动中的 ghost
        for (const child of Array.from(parentBlock.parentElement?.children ?? []) as HTMLElement[]) {
          if (child.dataset.blockId === dropTarget.beforeId && !child.classList.contains('block-ghost')) {
            return readRowRect(child)?.top ?? null
          }
        }
        return null
      }
      // 追加到祖父容器末尾 → 父块整棵静止子树之底
      return stationarySubtreeBottom(parentBlock)
    }

    // sort：锚点兄弟行顶；末尾追加 → 目标整棵静止子树之底
    if (dropTarget.beforeId) return readAnchorRowRect(targetBlockEl, dropTarget.beforeId)?.top ?? null
    return stationarySubtreeBottom(targetBlockEl)
  }

  /**
   * 渲染拖放指示器（更新响应式 ref，由 <BlockDropIndicator> 消费）
   *
   * 六种意图共用同一种槽位形态：2px 横线 + 左端向上的短竖头（样式见 _block.scss），
   * 横线水平位置即落位后的内容列（sort 同级 / nest 右移一级 / promote 左移一级），
   * 纵向锚点即插入间隙（resolveSlotTop）。所见即所得。
   */
  function renderDropIndicator(targetBlockEl: HTMLElement, dropTarget: DropTarget) {
    const bullet = targetBlockEl.querySelector('.block-bullet') as HTMLElement | null
    if (!bullet) {
      clearIndicator()
      return
    }

    const bulletRect = bullet.getBoundingClientRect()
    const rowRect = readRowRect(targetBlockEl)

    if (bulletRect.width <= 0 || bulletRect.height <= 0 || !rowRect || rowRect.height <= 0) {
      clearIndicator()
      return
    }

    const viewportHeight = window.innerHeight
    const viewportWidth = window.innerWidth

    if (rowRect.top > viewportHeight || rowRect.top + rowRect.height < 0) {
      clearIndicator()
      return
    }

    const clampX = (value: number) => Math.max(0, Math.min(value, viewportWidth - 1))
    const clampY = (value: number) => Math.max(0, Math.min(value, viewportHeight - 1))
    const rowRight = clampX(rowRect.right)

    // 槽位按目标深度列缩进；横线铺到行右端
    const depthOffset =
      dropTarget.action === 'nest'
        ? INDENT_TOTAL_PER_LEVEL
        : dropTarget.action === 'promote'
          ? -INDENT_TOTAL_PER_LEVEL
          : 0
    const contentLeft = clampX(bulletRect.left + depthOffset)
    const width = Math.max(1, rowRight - contentLeft)
    const top = clampY(resolveSlotTop(targetBlockEl, dropTarget) ?? rowRect.top)

    indicatorStyle.value = {
      left: `${contentLeft}px`,
      width: `${width}px`,
      top: `${top}px`,
      height: '2px'
    }
    indicatorClass.value = ''
    indicatorVisible.value = true
  }

  /** 隐藏拖放指示器 */
  function clearIndicator() {
    indicatorVisible.value = false
    indicatorClass.value = ''
    indicatorStyle.value = {}
  }

  /**
   * 循环嵌套守卫（VueDraggable @move 处理器）：返回 false 阻止 Sortable 把块插进自己的子树。
   *
   * 落位意图不在这里算 —— Sortable 只在「决定换位」的瞬间派发 @move，且被拖元素随后就挡住
   * 指针（拿不到后续采样），用它做意图会向下拖时偏上一个；意图统一由 handleDocumentPointerMove
   * 按指针位置实时重算。
   */
  function handleDragMove(evt: any): boolean {
    const draggedId = (evt.dragged as HTMLElement)?.dataset.blockId
    const toEl = evt.to as HTMLElement | undefined
    if (!draggedId || !toEl) return true

    const rawTargetId = toEl.dataset.parentId ?? null
    const targetId = rawTargetId === '' ? null : rawTargetId
    return !(targetId && isDescendantOf(blockStore.blocks, targetId, draggedId))
  }

  /**
   * 拖拽结束：回传落位意图、停止指针跟踪、清指示器并触发落库。
   *
   * VueDraggable @end 处理器。Sortable 已在 end 之前完成树 mutate（v-model，
   * 跨容器走 onRemove/onAdd 双向同步），但其落位是「同级重排 + 相邻容器吸附」，
   * 与 resolveDropAction 的判定并不一致（右区画 nest 线却落成 sort）。
   * 因此这里把本次意图交给调用方，由 applyDropTarget 校正后再落库，此处不写 store。
   *
   * 意图取的是「指针最后停住的位置」算出的那一条（handleDocumentPointerMove 维护）。
   * 指针停在被拖元素的占位行上时，那条意图等价于「留在 Sortable 放的槽位」，
   * applyDropTarget 自然成为 no-op —— 这正是向下拖不再偏一格的原因。
   */
  function handleBlockDragEnd(evt?: any) {
    // Esc 取消优先：回滚意图把被强制 splice 的树数组纠回原槽位
    const intent: DragEndIntent | null = pendingRevert
      ? pendingRevert
      : pendingIntent && pendingDraggedId
        ? { draggedId: pendingDraggedId, target: pendingIntent }
        : null
    // eslint-disable-next-line no-console
    console.log('[DBG end] from=', (evt?.from?.dataset?.parentId ?? '?') || 'ROOT', 'intent=', JSON.stringify(intent && { d: intent.draggedId.slice(0, 4), a: intent.target.action, p: (intent.target.toParentId ?? 'ROOT').slice(0, 4), b: (intent.target.beforeId ?? 'NULL').slice(0, 4) }))
    document.documentElement.dataset.dbgEnd = `end:from=${(evt?.from?.dataset?.parentId ?? '?') || 'ROOT'}:to=${(evt?.to?.dataset?.parentId ?? '?') || 'ROOT'}:old=${evt?.oldIndex}:new=${evt?.newIndex}:intent=${intent ? intent.target.action + '/' + ((intent.target.toParentId ?? 'ROOT').slice(0, 4)) + '/' + ((intent.target.beforeId ?? 'NULL').slice(0, 4)) : 'NULL'}`
    stopPointerTracking()
    pendingIntent = null
    pendingDraggedId = null
    pendingRevert = null
    clearIndicator()
    onDragEnd?.(intent)
  }

  // 组件在拖拽中被卸载（KeepAlive 切页等）时也要摘掉 document 级监听
  if (getCurrentInstance()) onBeforeUnmount(stopPointerTracking)

  return {
    indicatorStyle,
    indicatorClass,
    indicatorVisible,
    findDropTarget,
    renderDropIndicator,
    clearIndicator,
    handleDragStart,
    handleDragMove,
    handleBlockDragEnd
  }
}
