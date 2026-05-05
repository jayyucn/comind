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
import { ref, watch, onMounted, provide } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { useBlockStore } from '../stores/blocks'
import { useEditorStore } from '../stores/editor'
import Block from './Block/index.vue'
import { buildTree, syncTreeToStore } from '../composables/useBlockTree'
import type { TreeNode } from '../types/block'

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

// ── 提供给子 Block 组件 ──
provide('onDragEnd', handleDragEnd)

// ── 监听结构变化重建树 ──
watch(() => blockStore.structureVersion, syncFromStore)

// ── 页面 ID 变化时重建 ──
watch(() => props.pageId, syncFromStore)

onMounted(syncFromStore)
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
    <!-- 底部留白：确保拖拽到列表底部时目标容器被正确识别 -->
    <div class="block-list-padding" />
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
}
</style>
