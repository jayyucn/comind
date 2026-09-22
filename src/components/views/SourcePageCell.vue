<script setup lang="ts">
import { computed } from 'vue'
import { usePageStore } from '../../stores/pages'
import type { CellRendererProps } from './types'
import type { BlockCard } from '../../wasm/types'

// 来源页单元格（ADR-0050 D7）：`BlockCard.page_id` 经 TS pages store 映射为页标题
// （内置 `page` 字段只给 id，role='link' 又只渲染图钉按钮，都不足以读出「来自哪一页」）。
// 页未加载 / 已删 / 无 id 时回落原 id 或占位符。
// 只读：点击整格冒泡 → TableView 上报 cellClick → 业务层跳源页面（与 BlockContentCell 同款）。
const props = defineProps<CellRendererProps<BlockCard>>()

const pageStore = usePageStore()

const pageId = computed(() => props.item.page_id ?? '')
const title = computed(() => {
  if (!pageId.value) return '—'
  return pageStore.getPage(pageId.value)?.title ?? pageId.value
})
</script>

<template>
  <span
    class="source-page-cell"
    :title="title"
  >{{ title }}</span>
</template>

<style lang="scss" scoped>
.source-page-cell {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--text-secondary);
}
</style>
