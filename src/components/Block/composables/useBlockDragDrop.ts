import { ref } from 'vue'
import { isDescendantOf } from '../../../utils/block-helpers'
import { computeDropZone, computeSortPosition } from '../../../composables/useDragDrop'
import type { DragRect } from '../../../composables/useDragDrop'
import type { TreeNode } from '../../../types/block'
import type { useBlockStore } from '../../../stores/blocks'

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
  const { bulletRect, blockId, parentId, nextSiblingId } = geometry
  if (!bulletRect) return null

  const zone = computeDropZone(cursor.x, bulletRect)

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

  /** 从 DOM 读取放置判定所需的元数据（本模块唯一接触 DOM 的入口） */
  function readDropGeometry(targetBlockEl: HTMLElement): DropTargetGeometry {
    const bullet = targetBlockEl.querySelector('.block-bullet') as HTMLElement | null
    const parentBlock = targetBlockEl.parentElement?.closest('.block') as HTMLElement | null
    const nextSibling = targetBlockEl.nextElementSibling as HTMLElement | null
    return {
      blockId: targetBlockEl.dataset.blockId ?? null,
      parentId: parentBlock?.dataset.blockId ?? null,
      nextSiblingId: nextSibling?.dataset.blockId ?? null,
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

    const rect = bullet.getBoundingClientRect()

    if (rect.width <= 0 || rect.height <= 0) {
      clearIndicator()
      return
    }

    const viewportHeight = window.innerHeight
    const viewportWidth = window.innerWidth

    if (rect.bottom < 0 || rect.top > viewportHeight || rect.right < 0 || rect.left > viewportWidth) {
      clearIndicator()
      return
    }

    const left = Math.max(0, Math.min(rect.left, viewportWidth - 1))
    const width = Math.max(1, Math.min(rect.right - rect.left, viewportWidth - left))

    const style: Record<string, string> = {
      left: `${left}px`,
      width: `${width}px`,
      top: `${rect.top}px`,
      height: '2px'
    }
    let cssClass = ''

    if (dropTarget.action === 'sort') {
      const position = dropTarget.beforeId ? 'before' : 'after'
      if (position === 'after') {
        style.top = `${rect.bottom}px`
      } else {
        style.top = `${rect.top}px`
      }
      cssClass = 'sort'
    } else if (dropTarget.action === 'nest') {
      const targetDepth = parseInt(targetBlockEl.dataset.depth ?? '0', 10)
      const indentWidth = 24 * (targetDepth + 1)
      const nestLeft = Math.max(0, Math.min(rect.left + indentWidth, viewportWidth - 1))
      const nestWidth = Math.max(1, Math.min(rect.right - rect.left - indentWidth, viewportWidth - nestLeft))
      style.left = `${nestLeft}px`
      style.width = `${nestWidth}px`
      style.top = `${rect.top}px`
      style.height = `${Math.max(1, rect.height)}px`
      cssClass = 'nest'
    } else if (dropTarget.action === 'promote') {
      style.top = `${rect.top}px`
      cssClass = 'promote'
    }

    indicatorStyle.value = style
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
   * 以 indicatorVisible 作为「意图有效」的判据：所有非法/无效分支都会 clearIndicator，
   * 无需逐分支清理 pendingIntent。
   */
  function handleBlockDragEnd() {
    const intent: DragEndIntent | null =
      indicatorVisible.value && pendingIntent && pendingDraggedId
        ? { draggedId: pendingDraggedId, target: pendingIntent }
        : null
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
