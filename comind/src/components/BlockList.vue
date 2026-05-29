<script setup lang="ts">
/**
 * BlockList - 基于 TreeNode 树形结构的可拖拽 Block 列表容器
 *
 * 职责：
 * 1. 从 store 的扁平 blocks[] 构建 TreeNode 树
 * 2. 通过 VueDraggable 驱动根级渲染和拖拽
 * 3. 通过 provide 向子 Block 组件注入拖拽回调
 *
 * 架构：
 * - tree ref 是 VueDraggable 的 v-model 数据源（唯一渲染权威）
 * - 拖拽后 tree 已被 vue-draggable-plus 直接修改
 * - handleDragEnd 将 tree 变更同步回 store（parentId + pos）
 * - store 变更通过 structureVersion watch 触发 syncFromStore 重建树
 */
import { ref, watch, onMounted, onBeforeUnmount, provide } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { useBlockStore } from '../stores/blocks'
import { useEditorStore } from '../stores/editor'
import Block from './Block/index.vue'
import { buildTree, syncTreeToStore } from '../composables/useBlockTree'
import type { TreeNode } from '../types/block'
import { useCrossBlockSelection } from '../composables/useCrossBlockSelection'
import type { CrossBlockSelection } from '../composables/useCrossBlockSelection'

const props = defineProps<{
  /** 页面 ID，用于过滤 Block */
  pageId: string
  /** 父节点 ID，null 表示根级（保留兼容，当前固定为 null） */
  parentId?: string | null
}>()

const blockStore = useBlockStore()
const editorStore = useEditorStore()

// ── 树形结构（writable ref，作为 VueDraggable 的 v-model） ──
const tree = ref<TreeNode[]>([])

// ── 从 store 构建 tree ──
function syncFromStore() {
  tree.value = buildTree(blockStore.blocks, props.pageId)
}

// ── 拖拽结束：tree 已被 vue-draggable-plus 修改，同步回 store ──
function handleDragEnd() {
  const changed = syncTreeToStore(tree.value, null, blockStore.blocks)
  for (const id of changed) {
    blockStore.scheduleSave(id)
  }
  blockStore.structureVersion++
}

// ── 双击底部留白区域创建新 block ──
async function handleCreateBlock() {
  const newBlock = await blockStore.createBlock({
    pageId: props.pageId,
    parentId: null,
    content: '',
    format: {}
  })

  if (newBlock) {
    blockStore.structureVersion++
    editorStore.activateBlock(newBlock.id, 1)
  }
}

// ── 跨 Block 选区事件处理 ──
function handleDocMouseMove(e: MouseEvent) {
  if (!selection.dragStartBlockId.value) return

  const el = document.elementFromPoint(e.clientX, e.clientY)
  const blockEl = el?.closest('[data-block-id]') as HTMLElement | null
  if (!blockEl) return

  const targetId = blockEl.dataset.blockId
  if (!targetId) return

  if (!selection.isDragging.value) {
    if (targetId === selection.dragStartBlockId.value) return
    editorStore.deactivateBlock()
    selection.isDragging.value = true
  }

  const range = selection.computeRange(targetId, props.pageId)
  selection.selectedIds.clear()
  for (const id of range) {
    selection.selectedIds.add(id)
  }
}

function handleDocMouseUp(e: MouseEvent) {
  if (!selection.dragStartBlockId.value) {
    if (selection.anchorIds.size > 0) {
      const target = e.target as HTMLElement
      if (!target.closest('.block') && !target.closest('.block-list')) {
        selection.clearSelection()
      }
    }
    return
  }

  if (selection.isDragging.value) {
    selection.finalizeSelection()
  } else {
    const blockId = selection.dragStartBlockId.value
    selection.clearTracking()
    editorStore.activateBlock(blockId)
  }
}

function handleDocKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    selection.clearSelection()
    return
  }
  if ((e.key === 'c' || e.key === 'C') && (e.ctrlKey || e.metaKey)) {
    if (selection.anchorIds.size > 0) {
      e.preventDefault()
      selection.copyToClipboard(props.pageId)
    }
  }
}

// ── 提供给子 Block 组件 ──
const selection = useCrossBlockSelection()
provide<CrossBlockSelection>('crossBlockSelection', selection)
provide('onDragEnd', handleDragEnd)

// ── 监听结构变化重建树 ──
watch(() => blockStore.structureVersion, () => {
  syncFromStore()
})

// ── 页面 ID 变化时清除选区，同步由 structureVersion 变化触发 ──
watch(() => props.pageId, (newId, oldId) => {
  if (newId !== oldId) {
    selection.clearSelection()
    syncFromStore()
  }
})

onMounted(() => {
  syncFromStore()
  document.addEventListener('mousemove', handleDocMouseMove)
  document.addEventListener('mouseup', handleDocMouseUp)
  document.addEventListener('keydown', handleDocKeyDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousemove', handleDocMouseMove)
  document.removeEventListener('mouseup', handleDocMouseUp)
  document.removeEventListener('keydown', handleDocKeyDown)
})
</script>

<template>
  <div class="block-list">
    <VueDraggable
      v-model="tree"
      :group="{ name: 'blocks', pull: true, put: true }"
      handle=".block-bullet"
      :animation="150"
      ghost-class="block-ghost"
      drag-class="block-drag"
      chosen-class="block-chosen"
      :force-fallback="true"
      :empty-insert-threshold="0"
      data-parent-id=""
      @start="editorStore.deactivateBlock()"
      @end="handleDragEnd"
    >
      <Block v-for="node in tree" :key="node.id" :node="node" :page-id="pageId" :depth="0" />
    </VueDraggable>
    <!-- 底部留白：确保拖拽到列表底部时目标容器被正确识别，双击创建新 block -->
    <div class="block-list-padding" @dblclick="handleCreateBlock" />
  </div>
</template>

<style scoped>
.block-list {
  padding-left: 0;
  padding-bottom: 40px;
  min-height: 100px;
}

.block-list-padding {
  height: 40px;
  user-select: none;
  -webkit-user-select: none;
  cursor: default;
}
</style>
