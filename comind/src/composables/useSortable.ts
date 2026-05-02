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

import { ref, onMounted, onBeforeUnmount, type Ref, watch } from 'vue'
import Sortable from 'sortablejs'
import { useBlockStore } from '../stores/blocks'
import { useEditorStore } from '../stores/editor'

/**
 * Sortable 配置选项（提取为常量以便复用）
 */
function createSortableOptions(
  blockStore: ReturnType<typeof useBlockStore>, 
  editorStore: ReturnType<typeof useEditorStore>
) {
  return {
    group: 'blocks',
    animation: 150,
    ghostClass: 'block-ghost',
    dragClass: 'block-drag',
    chosenClass: 'block-chosen',
    handle: '.block-bullet',
    emptyInsertThreshold: 0,
    swap: false,
    forceFallback: true,
    onStart() {
      editorStore.deactivateBlock()
    },
    onMove(evt: { dragged: Element; related: Element | null; to: Element }) {
      const draggedId = (evt.dragged as HTMLElement).dataset.blockId
      const related = evt.related as HTMLElement

      if (draggedId && related) {
        const targetBlock = related.closest('.block') as HTMLElement | null
        if (targetBlock?.dataset.blockId === draggedId) {
          return false
        }
      }

      const rawTargetId = (evt.to as HTMLElement).dataset.parentId ?? null
      const targetId = rawTargetId === '' ? null : rawTargetId

      if (draggedId && blockStore.isDescendantOf(targetId, draggedId)) {
        return false
      }

      return true
    },
    onEnd: async (evt: { item: Element; from: Element; to: Element; oldIndex: number | undefined; newIndex: number | undefined }) => {
      const blockId = (evt.item as HTMLElement).dataset.blockId
      if (!blockId) return

      const fromEl = evt.from as HTMLElement
      const toEl = evt.to as HTMLElement
      const oldIndex = evt.oldIndex
      const draggedEl = evt.item as HTMLElement

      const rawToParentId = toEl.dataset.parentId ?? null
      const toParentId = rawToParentId === '' ? null : rawToParentId
      const newIndex = evt.newIndex ?? 0

      // 检测是否为跨容器拖拽（from !== to 表示跨层级移动）
      const isCrossContainer = fromEl !== toEl

      try {
        await blockStore.moveBlock({ blockId, toParentId, newIndex })

        // ── 跨容器拖拽后的 DOM 清理 ──
        //
        // 根因：Sortable.js 已将 draggedEl 从 fromEl 移到 toEl。
        // moveBlock 更新数据后 structureVersion++，触发：
        //   1. watch → createSortable() → destroy + recreate
        //   2. Vue 响应式 → blockTree 重算 → v-for 重新渲染
        // 如果不手动移除 Sortable 移动的元素，Vue 渲染的新节点与
        // Sortable 留下的旧节点重复 → 出现「多余的非编辑 block」。
        //
        // 修复：跨容器场景下，在 Sortable 重建前移除被拖拽的 DOM 元素，
        // 让 Vue 的 v-for 完全接管渲染。
        if (isCrossContainer && draggedEl.parentNode) {
          draggedEl.remove()
        }
      } catch (error) {
        console.error('[useSortable] moveBlock failed, rolling back DOM:', error)
        if (fromEl && oldIndex != null) {
          const refChild = fromEl.children[oldIndex] ?? null
          fromEl.insertBefore(evt.item, refChild)
        }
      }
    }
  }
}

/**
 * 使用响应式 ref 初始化 Sortable 实例
 *
 * 此函数必须在 setup 阶段调用，确保生命周期钩子正确注册。
 * Sortable 实例会在容器元素挂载后自动创建，在组件卸载时自动销毁。
 *
 * @param containerRef - 指向 .block-children 容器的 ref
 * @returns Sortable 实例的 ref（包含 reset 方法）
 */
export function useSortable(containerRef: Ref<HTMLElement | null>) {
  const blockStore = useBlockStore()
  const editorStore = useEditorStore()
  const sortableRef = ref<Sortable | null>(null)

  /** 创建 Sortable 实例 */
  function createSortable() {
    if (sortableRef.value) {
      sortableRef.value.destroy()
      sortableRef.value = null
    }
    if (containerRef.value) {
      sortableRef.value = Sortable.create(containerRef.value, createSortableOptions(blockStore, editorStore))
    }
  }

  /** 重置 Sortable 实例（销毁并重建） */
  function reset() {
    createSortable()
  }

  // 在 onMounted 中创建 Sortable 实例（此时 DOM 已挂载）
  onMounted(() => {
    createSortable()
  })

  // 监听结构版本号变化（indent/outdent 操作），自动重建 Sortable 实例
  watch(() => blockStore.structureVersion, () => {
    Promise.resolve().then(() => {
      createSortable()
    })
  })

  onBeforeUnmount(() => {
    if (sortableRef.value) {
      sortableRef.value.destroy()
      sortableRef.value = null
    }
  })

  return { sortable: sortableRef, reset }
}
