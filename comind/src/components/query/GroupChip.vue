<script setup lang="ts">
const props = defineProps<{
  /** 分组字段显示名。 */
  label: string
}>()

const emit = defineEmits<{
  /** 点击芯片主体 → 打开对应的 GroupMenu。 */
  open: []
  /** 点击 × → 取消分组。 */
  remove: []
}>()
</script>

<template>
  <span class="group-chip" data-testid="group-chip" @click="emit('open')">
    <span class="group-chip-label" data-testid="group-chip-label">分组：{{ label }}</span>
    <button
      type="button"
      class="group-chip-x"
      data-testid="group-chip-x"
      title="取消分组"
      @click.stop="emit('remove')"
    >
      ×
    </button>
  </span>
</template>

<style scoped>
.group-chip {
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
.group-chip:hover {
  border-color: var(--accent, #6366f1);
}
.group-chip-label {
  white-space: nowrap;
}
.group-chip-x {
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
.group-chip-x:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
</style>
