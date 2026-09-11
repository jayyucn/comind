import { ref } from 'vue'
import type { Ref } from 'vue'
import { isDescendantOf } from '../../../utils/block-helpers'
import { computeDropZone, computeSortPosition } from '../../../composables/useDragDrop'
import type { useBlockStore } from '../../../stores/blocks'

/**
 * 放置目标类型
 *
 * - sort: 同级排序（beforeId 指定插入到哪个 block 之前；null 表示追加到末尾）
 * - nest: 嵌套为目标 block 的子节点
 * - promote: 提升到目标 block 的父级（与目标 block 同级、位于其前）
 */
type DropAction = 'sort' | 'nest' | 'promote' | null

interface DropTarget {
  action: DropAction
  toParentId: string | null
  beforeId: string | null
}

interface UseBlockDragDropOptions {
  /** 当前 Block 的 ID（所属组件实例标识） */
  blockId: Ref<string>
  /** 当前 Block 所在页面 ID */
  pageId: string
  blockStore: ReturnType<typeof useBlockStore>
  /** 拖拽结束后的落库回调（由 BlockList / BlockModal 注入，syncTreeToStore 完整树 diff） */
  onDragEnd?: () => void
}

/**
 * useBlockDragDrop — Block 拖放逻辑 composable
 *
 * 从原 Block/index.vue 抽取的拖放逻辑：
 * - findDropTarget: 根据光标位置计算放置目标（sort/nest/promote）
 * - handleDragMove: VueDraggable @move 处理器，做循环嵌套检测并更新指示器
 * - handleBlockDragEnd: VueDraggable @end 处理器，清指示器并触发 onDragEnd 落库
 * - renderDropIndicator / clearIndicator: 通过响应式 ref 驱动 <BlockDropIndicator>
 *
 * 落库职责（单一写路径）：handleBlockDragEnd 不再调用 blockStore.moveBlock。
 * 拖拽结束后 Sortable 已完整 mutate 树（v-model，跨容器走 onRemove/onAdd 双向同步），
 * 落库统一由 onDragEnd 注入的 syncTreeToStore（完整树 diff）完成——主编辑器与 BlockModal 同源。
 *
 * 与原实现的关键变化：
 * - 不再使用 document.querySelector('.drop-indicator') 创建/更新 DOM 元素
 * - 指示器位置/样式/可见性通过 indicatorStyle / indicatorClass / indicatorVisible 暴露
 * - 这些 ref 为模块级共享状态：所有 Block 实例共用一个指示器，
 *   由 BlockList 通过 useSharedDropIndicator() 渲染单个 <BlockDropIndicator>
 *
 * 注意：
 * - handleDragMove 必须保留 boolean 返回值（false 阻止非法移动），由 BlockChildren
 *   通过 moveHandler prop 透传给 VueDraggable 的 @move。
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

  // ── 指示器响应式状态（模块级共享，所有 Block 实例共用）──
  const indicatorStyle = sharedIndicatorStyle
  const indicatorClass = sharedIndicatorClass
  const indicatorVisible = sharedIndicatorVisible

  /**
   * 根据光标位置计算放置目标
   *
   * 复制自原 Block/index.vue 的 findDropTarget：
   * - 左侧区域 → promote（提升到父级，位于目标前）
   * - 右侧区域 → nest（嵌套为目标子节点）
   * - 中间区域 → sort（按上下半区决定 before/after）
   */
  function findDropTarget(
    cursorX: number,
    cursorY: number,
    targetBlockEl: HTMLElement
  ): DropTarget | null {
    const bullet = targetBlockEl.querySelector('.block-bullet') as HTMLElement
    if (!bullet) return null

    const bulletRect = bullet.getBoundingClientRect()
    const zone = computeDropZone(cursorX, bulletRect)

    if (zone === 'left') {
      const parentBlock = targetBlockEl.parentElement?.closest('.block') as HTMLElement | null
      if (parentBlock) {
        return {
          action: 'promote',
          toParentId: parentBlock.dataset.blockId ?? null,
          beforeId: targetBlockEl.dataset.blockId ?? null
        }
      }
      return {
        action: 'sort',
        toParentId: null,
        beforeId: targetBlockEl.dataset.blockId ?? null
      }
    }

    if (zone === 'right') {
      return {
        action: 'nest',
        toParentId: targetBlockEl.dataset.blockId ?? null,
        beforeId: null
      }
    }

    const position = computeSortPosition(cursorY, bulletRect)
    const parentBlock = targetBlockEl.parentElement?.closest('.block') as HTMLElement | null
    const parentId = parentBlock?.dataset.blockId ?? null

    if (position === 'before') {
      return {
        action: 'sort',
        toParentId: parentId,
        beforeId: targetBlockEl.dataset.blockId ?? null
      }
    } else {
      const nextSibling = targetBlockEl.nextElementSibling as HTMLElement | null
      return {
        action: 'sort',
        toParentId: parentId,
        beforeId: nextSibling?.dataset.blockId ?? null
      }
    }
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
   * 拖拽结束：清指示器并触发落库。
   *
   * VueDraggable @end 处理器。Sortable 已在 end 之前完成树 mutate（v-model，
   * 跨容器走 onRemove/onAdd 双向同步），落库统一由 onDragEnd 注入的
   * syncTreeToStore（完整树 diff）完成，此处不再写 store。
   */
  function handleBlockDragEnd() {
    clearIndicator()
    onDragEnd?.()
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
