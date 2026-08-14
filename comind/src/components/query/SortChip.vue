<script setup lang="ts">
import type { SortRule } from '../../core/query'

const props = defineProps<{
  /** 排序规则。 */
  rule: SortRule
  /** 字段显示名。 */
  label: string
}>()

const emit = defineEmits<{
  /** 点击芯片主体 → 打开对应的 SortMenu。 */
  open: []
  /** 点击 × → 移除该排序。 */
  remove: []
}>()

const arrow = props.rule.dir === 'asc' ? '↑' : '↓'
</script>

<template>
  <span class="sort-chip" data-testid="sort-chip" @click="emit('open')">
    <span class="sort-chip-label" data-testid="sort-chip-label">{{ arrow }} {{ label }}</span>
    <button
      type="button"
      class="sort-chip-x"
      data-testid="sort-chip-x"
      title="移除排序"
      @click.stop="emit('remove')"
    >
      ×
    </button>
  </span>
</template>

<style scoped>
.sort-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px 2px 8px;
  background: var(--bg-base2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
  transition: border-color 120ms ease, background 120ms ease;
}
.sort-chip:hover {
  border-color: var(--accent, #6366f1);
}
.sort-chip-label {
  white-space: nowrap;
}
.sort-chip-x {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}
.sort-chip-x:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
</style>
