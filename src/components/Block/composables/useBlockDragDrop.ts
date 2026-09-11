import { ref } from 'vue'
import { isDescendantOf } from '../../../utils/block-helpers'
import { computeDropZone, computeSortPosition } from '../../../composables/useDragDrop'
import type { DragRect } from '../../../composables/useDragDrop'
import type { TreeNode } from '../../../types/block'
import type { useBlockStore } from '../../../stores/blocks'

/**
 * 一级缩进总宽（px）= `.block-children` 的 `padding-left`(20) + Block/index.vue 的
 * `INDENT_WIDTH_PER_LEVEL`(24)。改其中任一处，此常量必须同步。
 *
 * 不要用目标块的 `depth` 参与计算：bullet 的 x 已包含行内 `.block-indent` 的累计
 * 缩进，再乘层级会把缩进算两遍（详见 docs/sort/sortable-implementation.md §9）。
 */
const INDENT_TOTAL_PER_LEVEL = 44

/**
 * 放置目标类型
 *
 * - sort: 同级排序（beforeId 指定插入到哪个 block 之前；null 表示追加到末尾）
 * - nest: 嵌套为目标 block 的子节点
 * - promote: 提升到目标 block 的父级（与目标 block 同级、位于其前）
 */
export type DropAction = 'sort' | 'nest' | 'promote' | null

export interface DropTarget {
  action: DropAction
  toParentId: string | null
  beforeId: string | null
}

/** 放置判定的输入：目标块的可测元数据（纯数据，不含 DOM 引用） */
export interface DropTargetGeometry {
  /** 目标块的 blockId */
  blockId: string | null
  /** 目标块的父块 id（sort / promote 的归属父级；根级为 null） */
  parentId: string | null
  /** 目标块在同级的下一块 id（sort-after 的 beforeId；null 表示追加到末尾） */
  nextSiblingId: string | null
  /** 目标块 bullet 的矩形；null 表示无 bullet，不可作为放置目标 */
  bulletRect: DragRect | null
  /**
   * 目标块整行（`.block-row`）的矩形，水平三分区的基准；null 时退回 bulletRect。
   *
   * 必须用行矩形而非 bullet 矩形：bullet 实测仅 20px 宽，扣掉左右各 15px 阈值后
   * 中区为空集（`left + 15 > right - 15`），sort-after 永远无法用手势表达。
   */
  rowRect?: DragRect | null
}

/**
 * 放置判定核心（纯函数）：由光标位置 + 目标块元数据解出放置语义。
 *
 * - 左区 → promote（提升到父级、位于目标之前）；目标已在根级时退化为 sort
 * - 右区 → nest（成为目标块的子节点）
 * - 中区 → sort（按上下半区决定位于目标之前 / 之后）
 *
 * 无 DOM 依赖，可直接单测。
 */
export function resolveDropAction(
  cursor: { x: number; y: number },
  geometry: DropTargetGeometry
): DropTarget | null {
  const { bulletRect, rowRect, blockId, parentId, nextSiblingId } = geometry
  if (!bulletRect) return null

  // 水平分区以整行矩形为基准（缺省退回 bullet）：bullet 仅 20px 宽，用它做基准时中区为空集
  const zone = computeDropZone(cursor.x, rowRect ?? bulletRect)

  if (zone === 'left') {
    if (parentId) {
      return { action: 'promote', toParentId: parentId, beforeId: blockId }
    }
    return { action: 'sort', toParentId: null, beforeId: blockId }
  }

  if (zone === 'right') {
    return { action: 'nest', toParentId: blockId, beforeId: null }
  }

  const position = computeSortPosition(cursor.y, bulletRect)
  return {
    action: 'sort',
    toParentId: parentId,
    beforeId: position === 'before' ? blockId : nextSiblingId
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
 * - findDropTarget: DOM 适配层，读取目标块元数据后交给 resolveDropAction
 * - handleDragMove: VueDraggable @move 处理器，做循环嵌套检测并更新指示器
 * - handleBlockDragEnd: VueDraggable @end 处理器，回传落位意图并触发 onDragEnd
 * - renderDropIndicator / clearIndicator: 通过响应式 ref 驱动 <BlockDropIndicator>
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

  /** 最近一次 @move 判定出的落位意图（本次拖拽期内有效，@end 时消费） */
  let pendingIntent: DropTarget | null = null
  let pendingDraggedId: string | null = null

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

  /** 从 DOM 读取放置判定所需的元数据（本模块唯一接触 DOM 的入口） */
  function readDropGeometry(targetBlockEl: HTMLElement): DropTargetGeometry {
    const bullet = targetBlockEl.querySelector('.block-bullet') as HTMLElement | null
    const parentBlock = targetBlockEl.parentElement?.closest('.block') as HTMLElement | null
    const nextSibling = targetBlockEl.nextElementSibling as HTMLElement | null
    return {
      blockId: targetBlockEl.dataset.blockId ?? null,
      parentId: parentBlock?.dataset.blockId ?? null,
      nextSiblingId: nextSibling?.dataset.blockId ?? null,
      bulletRect: bullet ? bullet.getBoundingClientRect() : null,
      rowRect: readRowRect(targetBlockEl)
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
   * 渲染拖放指示器（更新响应式 ref，由 <BlockDropIndicator> 消费）
   *
   * 替代原 renderDropIndicator + getOrCreateIndicator 的 DOM 操作。
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

    // 三种指示器各锚定一个内容列（均以 bullet 为基准，兄弟关系由一级缩进量表达）：
    // - sort    本行内容列：bullet 左边缘
    // - promote 父级内容列：左移一级缩进
    // - nest    子级内容列：右移一级缩进（竖线）
    // 横线宽度铺到行右端 —— 旧实现取 bullet 的 20px 宽，线短到几乎看不见。
    let contentLeft = clampX(bulletRect.left)
    let width = Math.max(1, rowRight - contentLeft)
    let top = clampY(rowRect.top)
    let height = '2px'
    let cssClass = ''

    if (dropTarget.action === 'sort') {
      // beforeId 为 null 表示追加到末尾，线画在行底部
      if (!dropTarget.beforeId) top = clampY(rowRect.top + rowRect.height)
      cssClass = 'sort'
    } else if (dropTarget.action === 'nest') {
      contentLeft = clampX(bulletRect.left + INDENT_TOTAL_PER_LEVEL)
      width = 1
      height = `${Math.max(1, rowRect.height)}px`
      cssClass = 'nest'
    } else if (dropTarget.action === 'promote') {
      contentLeft = clampX(bulletRect.left - INDENT_TOTAL_PER_LEVEL)
      width = Math.max(1, rowRight - contentLeft)
      cssClass = 'promote'
    }

    indicatorStyle.value = {
      left: `${contentLeft}px`,
      width: `${width}px`,
      top: `${top}px`,
      height
    }
    indicatorClass.value = cssClass
    indicatorVisible.value = true
  }

  /** 隐藏拖放指示器 */
  function clearIndicator() {
    indicatorVisible.value = false
    indicatorClass.value = ''
    indicatorStyle.value = {}
  }

  /**
   * 拖拽移动检测（防止循环嵌套）
   *
   * VueDraggable @move 处理器：返回 false 阻止非法移动。
   * 复制自原 Block/index.vue 的 handleDragMove。
   */
  function handleDragMove(evt: any): boolean | void {
    const draggedId = (evt.dragged as HTMLElement)?.dataset.blockId
    const related = evt.related as HTMLElement

    if (draggedId && related) {
      const targetBlock = related.closest('.block') as HTMLElement | null
      if (targetBlock?.dataset.blockId === draggedId) {
        clearIndicator()
        return false
      }
    }

    const toEl = evt.to as HTMLElement
    if (!toEl) {
      clearIndicator()
      return true
    }

    const rawTargetId = toEl.dataset.parentId ?? null
    const targetId = rawTargetId === '' ? null : rawTargetId

    if (draggedId && targetId && isDescendantOf(blockStore.blocks, targetId, draggedId)) {
      clearIndicator()
      return false
    }

    const cursorX = evt.originalEvent.clientX
    const cursorY = evt.originalEvent.clientY
    const targetBlock = related?.closest('.block') as HTMLElement | null

    if (!targetBlock) {
      clearIndicator()
      return true
    }

    const dropTarget = findDropTarget(cursorX, cursorY, targetBlock)
    if (dropTarget) {
      // 记录意图：@end 时以它为准校正 Sortable 的落位（早退分支都不记录，天然作废）
      pendingIntent = dropTarget
      pendingDraggedId = draggedId ?? null

      const bullet = targetBlock.querySelector('.block-bullet')
      if (!bullet) {
        clearIndicator()
        return true
      }

      const rect = (bullet as HTMLElement).getBoundingClientRect()
      if (rect.top < 0 || rect.bottom > window.innerHeight) {
        clearIndicator()
        return true
      }

      renderDropIndicator(targetBlock, dropTarget)
    } else {
      clearIndicator()
    }

    return true
  }

  /**
   * 拖拽结束：回传落位意图、清指示器并触发落库。
   *
   * VueDraggable @end 处理器。Sortable 已在 end 之前完成树 mutate（v-model，
   * 跨容器走 onRemove/onAdd 双向同步），但其落位是「同级重排 + 相邻容器吸附」，
   * 与 resolveDropAction 的判定并不一致（右区画 nest 线却落成 sort）。
   * 因此这里把本次意图交给调用方，由 applyDropTarget 校正后再落库，此处不写 store。
   *
   * 判据只用 pendingIntent（最后一条有效意图），**不能用 indicatorVisible**：
   * 拖拽末段指针常落在被拖块自身或其它无效位置（ghost 跟随指针，指针就压在它上方），
   * 此时 handleDragMove 会 clearIndicator 隐藏指示线，但用户最后看到的那条线依然有效 ——
   * 用它作判据会连带作废意图，表现为「明明看到 nest 线，落位却按 Sortable 自然结果」
   * （真机实测：拖到目标行右端后落位跑到了隔壁块下）。
   * pendingIntent 只在成功判定分支赋值、且每次 @end 后重置，不会跨次残留。
   */
  function handleBlockDragEnd() {
    const intent: DragEndIntent | null =
      pendingIntent && pendingDraggedId ? { draggedId: pendingDraggedId, target: pendingIntent } : null
    pendingIntent = null
    pendingDraggedId = null
    clearIndicator()
    onDragEnd?.(intent)
  }

  return {
    indicatorStyle,
    indicatorClass,
    indicatorVisible,
    findDropTarget,
    renderDropIndicator,
    clearIndicator,
    handleDragMove,
    handleBlockDragEnd
  }
}
