/**
 * Sortable.js 拖拽 composable
 *
 * 职责：
 * - 每个 .block-children 容器初始化一个 Sortable 实例
 * - 在 onEnd 中调用 blockStore.moveBlock() 更新数据
 * - onMove 钩子中做循环嵌套检测
 */

import { onBeforeUnmount } from 'vue'
import Sortable from 'sortablejs'
import { useBlockStore } from '../stores/blocks'

export function useSortable(el: HTMLElement) {
  const blockStore = useBlockStore()

  const sortable = Sortable.create(el, {
    // 跨容器拖拽：所有 block-children 用同一个 group name
    group: 'blocks',

    // 拖拽动画时长（ms）
    animation: 150,

    // ghost 样式类（被拖拽的"影子"元素）
    ghostClass: 'block-ghost',

    // 正在被拖拽的原始元素样式
    dragClass: 'block-drag',

    // 拖拽手柄：只允许从 bullet 区域拖拽
    handle: '.block-bullet',

    // onMove：拖拽过程中判断是否能放置
    // 返回 false → Sortable 显示"禁止"图标，阻止放置
    onMove(evt) {
      const targetId = (evt.to as HTMLElement).dataset.parentId || null
      const draggedId = (evt.dragged as HTMLElement).dataset.blockId

      if (draggedId && blockStore.isDescendantOf(targetId, draggedId)) {
        return false
      }

      return true
    },

    // onEnd：拖拽结束，核心回调
    // 注意：Sortable.js 已在 DOM 层面移动了元素，此处只更新数据
    onEnd(evt) {
      const blockId = (evt.item as HTMLElement).dataset.blockId
      if (!blockId) return

      const fromParentId = (evt.from as HTMLElement).dataset.parentId || null
      const toParentId = (evt.to as HTMLElement).dataset.parentId || null
      const newIndex = evt.newIndex ?? 0

      blockStore.moveBlock({ blockId, fromParentId, toParentId, newIndex })
    }
  })

  onBeforeUnmount(() => {
    sortable.destroy()
  })

  return sortable
}
