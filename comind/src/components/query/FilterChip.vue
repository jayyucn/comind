<script setup lang="ts">
defineProps<{ label: string; active?: boolean }>()
const emit = defineEmits<{ click: [e: MouseEvent]; remove: [] }>()
</script>

<template>
  <span
    class="filter-chip"
    :class="{ active }"
    data-testid="filter-chip"
    @click="emit('click', $event)"
  >
    <span class="chip-label">{{ label }}</span>
    <button
      class="chip-remove"
      type="button"
      data-testid="chip-remove"
      aria-label="移除筛选"
      @click.stop="emit('remove')"
    >×</button>
  </span>
</template>

<style scoped>
.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 4px 3px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: var(--text-sm);
  cursor: pointer;
  user-select: none;
}
.filter-chip:hover {
  border-color: var(--accent);
}
.filter-chip.active {
  border-color: var(--accent);
  background: var(--accent-subtle, var(--bg-base2, var(--bg-base)));
  color: var(--accent);
}
.chip-remove {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 4px;
  border-radius: 50%;
}
.chip-remove:hover {
  background: var(--bg-hover);
}
</style>
