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
function createSortableOptions(blockStore: ReturnType<typeof useBlockStore>, editorStore: ReturnType<typeof useEditorStore>) {
  return {
    group: {
      name: 'blocks',
      pull: true,
      put: true
    },
    animation: 150,
    ghostClass: 'block-ghost',
    dragClass: 'block-drag',
    chosenClass: 'block-chosen',
    handle: '.block-bullet',
    emptyInsertThreshold: 0,
    swap: false,
    fallbackOnBody: false,
    removeCloneOnHide: true,
    onStart(evt: { item: Element }) {
      editorStore.deactivateBlock()
      
      const item = evt.item as HTMLElement
      item.classList.add('block-drag')
    },
    onEnd(evt: { item: Element; from: Element; to: Element; oldIndex: number | undefined; newIndex: number | undefined; clone: Element | undefined }) {
      const item = evt.item as HTMLElement
      const clone = evt.clone as HTMLElement
      
      item.classList.remove('block-drag')
      item.classList.remove('block-chosen')
      
      if (clone) {
        clone.remove()
      }

      const blockId = item.dataset.blockId
      if (!blockId) {
        item.remove()
        return
      }

      const fromEl = evt.from as HTMLElement
      const oldIndex = evt.oldIndex

      const rawToParentId = (evt.to as HTMLElement).dataset.parentId ?? null
      const toParentId = rawToParentId === '' ? null : rawToParentId
      const newIndex = evt.newIndex ?? 0

      blockStore.moveBlock({ blockId, toParentId, newIndex }).catch((error) => {
        console.error('[useSortable] moveBlock failed, rolling back DOM:', error)
        if (fromEl && oldIndex != null) {
          const refChild = fromEl.children[oldIndex] ?? null
          fromEl.insertBefore(evt.item, refChild)
        }
      })
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

  // 监听结构版本号变化，自动重建 Sortable 实例
  // 解决缩进/反缩进后 DOM 与 Sortable 状态不同步的问题
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
