<script setup lang="ts">
import { computed } from 'vue'
import { useBlockStore } from '../stores/blocks'
import Block from './Block/index.vue'

const props = defineProps<{
  pageId: string
  topLevelOnly?: boolean
}>()

const blockStore = useBlockStore()

const blocks = computed(() => {
  let list = blockStore.blocks.filter(b => b.pageId === props.pageId)
  if (props.topLevelOnly) {
    list = list.filter(b => b.parentId === null)
  }
  // 按 leftId 排序
  return list.sort((a, b) => {
    if (!a.leftId) return -1
    if (!b.leftId) return 1
    return a.leftId.localeCompare(b.leftId)
  })
})
</script>

<template>
  <div class="block-list">
    <Block
      v-for="block in blocks"
      :key="block.id"
      :block-id="block.id"
      :block="block"
    />
  </div>
</template>