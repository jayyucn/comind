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
  <!-- 单根壳：页面路由转场（App.vue page-route）要求 Transition 内组件恒为元素根；
       ready 前的 v-if 注释节点会让 Transition 视作 non-element root 并告警。 -->
  <div class="tag-aggregate-route-shell">
    <TagAggregateBody
      v-if="ready"
      :key="tagId"
      :tag-id="tagId"
    />
  </div>
</template>

<style lang="scss" scoped>
// 单根壳：只做高度直通，不改布局（TagAggregateBody 的撑满逻辑不受影响）
.tag-aggregate-route-shell {
  height: 100%;
}
</style>
