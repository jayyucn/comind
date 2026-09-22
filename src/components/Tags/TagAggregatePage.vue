<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useBlockCardStore } from '../../stores/blockCard'
import { usePageStore } from '../../stores/pages'
import { useTagsStore } from '../../stores/tags'
import TagAggregateBody from './TagAggregateBody.vue'

/**
 * tag 聚合页数据门（ADR-0050 D7）——路由目标组件。
 *
 * 先把三份投影备齐再挂载页面本体：
 * - 标签树（含 Rust 解析出的有效字段 / 后代闭包）
 * - 卡片投影（成员集合的来源）
 * - 页面标题表（来源页列映射）
 *
 * 本体的视图配置命名空间（`tag:<id>`）与表格列模板都在 setup 期定形，必须等数据到位；
 * `:key="tagId"` 保证在**同一路由内换 tag**（示例：在本页抽屉里点另一个 `#chip`）时整体重建——
 * 否则列模板与命名空间会停留在上一个 tag。
 */
defineProps<{ tagId: string }>()

const tagsStore = useTagsStore()
const blockCardStore = useBlockCardStore()
const pageStore = usePageStore()
const ready = ref(false)

onMounted(async () => {
  await Promise.all([
    tagsStore.ensureLoaded(),
    blockCardStore.getCards(),
    pageStore.ensurePagesLoaded(),
  ])
  ready.value = true
})
</script>

<template>
  <TagAggregateBody
    v-if="ready"
    :key="tagId"
    :tag-id="tagId"
  />
</template>
