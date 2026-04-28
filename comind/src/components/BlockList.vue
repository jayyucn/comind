<script setup lang="ts">
/**
 * BlockList - 可拖拽的 Block 列表容器
 *
 * 职责：
 * 1. 渲染 Block 列表
 * 2. 提供拖拽功能（通过 useSortable）
 * 3. 提供底部留白（解决 Sortable 目标容器误判问题）
 *
 * 使用场景：
 * - Page/index.vue（页面 Block 列表）
 * - Journal/JournalListItem.vue（日记条目 Block 列表）
 */
import { computed, ref } from 'vue'
import { useBlockStore } from '../stores/blocks'
import { useSortable } from '../composables/useSortable'
import Block from './Block/index.vue'

const props = defineProps<{
  /** 页面 ID，用于过滤 Block */
  pageId: string
  /** 父节点 ID，null 表示根级 */
  parentId?: string | null
}>()

const blockStore = useBlockStore()
const blockListRef = ref<HTMLElement | null>(null)

// 根容器的 Sortable（必须在 setup 阶段调用）
useSortable(blockListRef)

const blocks = computed(() => {
  const parentId = props.parentId ?? null
  return blockStore.blocks
    .filter(b => b.parentId === parentId && b.pageId === props.pageId)
    .sort((a, b) => a.pos - b.pos)
})
</script>

<template>
  <div
    class="block-list"
    ref="blockListRef"
    :data-parent-id="parentId ?? ''"
  >
    <Block
      v-for="block in blocks"
      :key="block.id"
      :block-id="block.id"
      :block="block"
    />
  </div>
</template>

<style scoped>
.block-list {
  padding-left: 0;
  /* 底部留白：确保 Sortable.js 能识别容器底部区域 */
  /* 解决：拖拽节点到列表底部时，目标容器被误判为最后一个 Block 的 .block-children */
  padding-bottom: 40px;
  min-height: 100px;
}
</style>
