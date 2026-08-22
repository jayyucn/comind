<script setup lang="ts">
import { computed } from 'vue'
import BulletRender from '../Block/handlers/bullet/BulletRender.vue'
import type { CellRendererProps } from './types'
import type { BlockCard } from '../../wasm/types'

// 只读富预览单元格（ADR-0010 首个消费方）：用标准 Block 渲染器 BulletRender 渲染 content_preview。
// content 编辑走抽屉，故不 emit change；点击整格冒泡 → TableView 上报 cellClick → 业务层导航。
const props = defineProps<CellRendererProps<BlockCard>>()

// 完成态（status==='Done'）透传行置灰的删线表现（内置 primary 分支的删线由默认链负责，自定义格需自管）。
const done = computed(() => props.item.properties?.['status'] === 'Done')

/** 表格内无法渲染图片，且 BulletRender 回退模式不解析图片语法，故剥离嵌入图；
 *  [[wikilink]] / #tag 保留交给 BulletRender（有 segments 时渲染成 chip，否则显示原生 [[…]]）。 */
function stripImageEmbeds(raw: unknown): string {
  return String(raw ?? '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')   // ![alt](url) → 删除
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [text](url) → text
}

// 自定义 property（非内置）作为标签徽章展示。
const BUILTIN = new Set([
  'status', 'priority', 'project', 'area', 'dateRefKind', 'dateRefDate',
  'content', 'page', 'done', 'deadline', 'schedule',
])
const tags = computed(() =>
  Object.entries(props.item.properties ?? {})
    .filter(([k, v]) => !BUILTIN.has(k) && v != null)
    .map(([k, v]) => `${k}: ${String(v)}`),
)
</script>

<template>
  <div class="block-content-cell" :class="{ 'is-done': done }">
    <BulletRender :content="stripImageEmbeds(value)" :block-id="item.block_id" />
    <span v-for="t in tags" :key="t" class="tag">{{ t }}</span>
  </div>
</template>

<style lang="scss" scoped>
.block-content-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;

  // 富预览限两行，避免撑高表格行
  :deep(.block-text) {
    flex: 1 1 auto;
    min-width: 0;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    color: var(--text-primary);
  }

  &.is-done :deep(.block-text) {
    text-decoration: line-through;
    color: var(--text-tertiary);
  }

  .tag {
    flex-shrink: 0;
    padding: 1px 5px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 11px;
    color: var(--text-secondary);
  }
}
</style>
