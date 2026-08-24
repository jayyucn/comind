<script setup lang="ts">
/** 每页行数下拉可选值。 */
const PAGE_SIZE_OPTIONS = [20, 50, 100] as const

const props = defineProps<{
  /** 总记录数（驱动「共 N 条」）。 */
  total: number
  /** 当前页（1-based，受控）。 */
  page: number
  /** 总页数（驱动「第 x/N 页」与按钮禁用）。 */
  totalPages: number
  /** 每页行数（受控）。 */
  pageSize: number
  /** 每页行数下拉可选值（缺省 20/50/100）。 */
  pageSizeOptions?: readonly number[]
}>()

const emit = defineEmits<{
  /** 请求切页（上一页/下一页；父组件负责 clamp）。 */
  'update:page': [page: number]
  /** 请求切换每页行数。 */
  'update:pageSize': [size: number]
}>()

function onPrev() {
  if (props.page > 1) emit('update:page', props.page - 1)
}

function onNext() {
  if (props.page < props.totalPages) emit('update:page', props.page + 1)
}

function onSizeChange(e: Event) {
  emit('update:pageSize', Number((e.target as HTMLSelectElement).value))
}
</script>

<template>
  <div class="pagination-footer" data-testid="pagination-bar">
    <select
      class="page-size-select"
      :value="pageSize"
      data-testid="page-size-select"
      @change="onSizeChange"
    >
      <option v-for="n in pageSizeOptions ?? PAGE_SIZE_OPTIONS" :key="n" :value="n">{{ n }} 条/页</option>
    </select>
    <span class="pagination-total">共 {{ total }} 条</span>
    <span class="pagination-info">第 {{ page }}/{{ totalPages }} 页</span>
    <button
      type="button"
      class="pagination-btn"
      :disabled="page <= 1"
      data-testid="page-prev"
      @click="onPrev"
    >‹ 上一页</button>
    <button
      type="button"
      class="pagination-btn"
      :disabled="page >= totalPages"
      data-testid="page-next"
      @click="onNext"
    >下一页 ›</button>
  </div>
</template>

<style lang="scss" scoped>
/* 固定底部分页条（ADR-0024 D4）：置于滚动容器之外，内容滚动时保持可见 */
.pagination-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 10px 12px;
  border-top: 1px solid var(--border-color, var(--app-split));
  background: var(--bg-base);
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.page-size-select {
  padding: 3px 6px;
  border: 1px solid var(--border-color, var(--app-split));
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: var(--text-xs);
  font-family: inherit;
  cursor: pointer;
  color-scheme: light dark;

  &:hover {
    border-color: var(--accent);
  }
}

.pagination-total,
.pagination-info {
  white-space: nowrap;
}

.pagination-btn {
  padding: 3px 10px;
  border: 1px solid var(--border-color, var(--app-split));
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: var(--text-xs);
  font-family: inherit;
  cursor: pointer;
  transition: border-color 80ms ease, color 80ms ease;

  &:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
}
</style>
