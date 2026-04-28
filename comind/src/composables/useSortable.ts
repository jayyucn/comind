/**
 * Sortable.js 拖拽 composable
 *
 * 职责：
 * - 每个 .block-children 容器初始化一个 Sortable 实例
 * - 在 onEnd 中调用 blockStore.moveBlock() 更新数据
 * - onMove 钩子中做循环嵌套检测
 *
 * 使用方式（必须在 setup 阶段调用）：
 * ```ts
 * const containerRef = ref<HTMLElement | null>(null)
 * const sortableRef = useSortable(containerRef)
 * ```
 */

import { ref, onMounted, onBeforeUnmount, type Ref } from 'vue'
import Sortable from 'sortablejs'
import { useBlockStore } from '../stores/blocks'
import { useEditorStore } from '../stores/editor'

/**
 * 使用响应式 ref 初始化 Sortable 实例
 *
 * 此函数必须在 setup 阶段调用，确保生命周期钩子正确注册。
 * Sortable 实例会在容器元素挂载后自动创建，在组件卸载时自动销毁。
 *
 * @param containerRef - 指向 .block-children 容器的 ref
 * @returns Sortable 实例的 ref（可用于手动控制）
 */
export function useSortable(containerRef: Ref<HTMLElement | null>) {
  const blockStore = useBlockStore()
  const sortableRef = ref<Sortable | null>(null)

  // 在 onMounted 中创建 Sortable 实例（此时 DOM 已挂载）
  onMounted(() => {
    if (containerRef.value) {
      sortableRef.value = Sortable.create(containerRef.value, {
        // 跨容器拖拽：所有 block-children 用同一个 group name
        group: 'blocks',

        // 拖拽动画时长（ms）
        animation: 150,

        // ghost 样式类（被拖拽的"影子"元素）
        ghostClass: 'block-ghost',

        // 正在被拖拽的原始元素样式
        dragClass: 'block-drag',

        // 占位符样式类（拖拽过程中目标位置的占位符）
        // 跨容器拖拽时，Sortable 会创建一个占位符元素
        chosenClass: 'block-chosen',

        // 拖拽手柄：只允许从 bullet 区域拖拽
        handle: '.block-bullet',

        // 禁用幽灵元素的默认样式，使用自定义 CSS
        // forceFallback: true,
        // fallbackClass: 'block-ghost',
        // fallbackOnBody: true,

        // 禁用空容器的占位符（避免跨容器拖拽时出现多余元素）
        emptyInsertThreshold: 0,

        // 禁用 swap 模式（避免出现横向占位符）
        swap: false,

        // 禁用默认的拖拽占位符样式
        // removeCloneOnHide: true,

        // swapThreshold: 0.65,
        // invertSwap: true,

        // onStart：拖拽开始时，让当前活跃 block 失活
        // 避免拖拽过程中编辑器仍然处于编辑状态
        onStart() {
          const editorStore = useEditorStore()
          editorStore.deactivateBlock()
        },

        // onMove：拖拽过程中判断是否能放置
        // 返回 false → Sortable 显示"禁止"图标，阻止放置
        onMove(evt) {
          const draggedId = (evt.dragged as HTMLElement).dataset.blockId
          const related = evt.related as HTMLElement

          // B-4 修复：如果放置到自身或自身内容区域，阻止放置
          // evt.related 是 Sortable 正在hover的元素
          if (draggedId && related) {
            const targetBlock = related.closest('.block') as HTMLElement | null
            // 检测目标是否是自身
            if (targetBlock?.dataset.blockId === draggedId) {
              return false
            }
          }

          // data-parent-id="" 在 JS 中是空字符串 ''，而根级 parentId 实际是 null
          // 需统一：空字符串 → null
          const rawTargetId = (evt.to as HTMLElement).dataset.parentId ?? null
          const targetId = rawTargetId === '' ? null : rawTargetId

          if (draggedId && blockStore.isDescendantOf(targetId, draggedId)) {
            return false
          }

          return true
        },

        // onEnd：拖拽结束，核心回调
        // 注意：Sortable.js 已在 DOM 层面移动了元素，此处只更新数据
        // B-2 修复：使用 async/await 确保异步操作完成，防止并发导致数据不一致
        // B-3 修复：失败时回滚 DOM，保持 DOM 与数据层一致
        onEnd: async (evt) => {
          const blockId = (evt.item as HTMLElement).dataset.blockId
          if (!blockId) return

          // 记录原始位置，用于失败时回滚
          const fromEl = evt.from as HTMLElement
          const oldIndex = evt.oldIndex

          // data-parent-id="" 在 JS 中是空字符串 ''，而根级 parentId 实际是 null
          // 需统一：空字符串 → null，保持与 Block.parentId 类型一致
          const rawToParentId = (evt.to as HTMLElement).dataset.parentId ?? null
          const toParentId = rawToParentId === '' ? null : rawToParentId
          const newIndex = evt.newIndex ?? 0

          try {
            await blockStore.moveBlock({ blockId, toParentId, newIndex })
          } catch (error) {
            console.error('[useSortable] moveBlock failed, rolling back DOM:', error)
            // 将元素移回原始容器和位置
            // Sortable 移除元素后 children 已偏移，所以 fromEl.children[oldIndex] 指向原位置的下一个元素
            // insertBefore(item, refChild) 会把 item 插到 refChild 前面，恰好恢复原位置
            if (fromEl && oldIndex != null) {
              const refChild = fromEl.children[oldIndex] ?? null
              fromEl.insertBefore(evt.item, refChild)
            }
          }
        }
      })
    }
  })

  // 在 onBeforeUnmount 中销毁 Sortable 实例
  // 注意：此钩子在 setup 阶段注册，确保组件卸载时执行
  onBeforeUnmount(() => {
    if (sortableRef.value) {
      sortableRef.value.destroy()
      sortableRef.value = null
    }
  })

  return sortableRef
}
