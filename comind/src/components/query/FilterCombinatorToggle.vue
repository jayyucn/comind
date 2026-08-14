<script setup lang="ts">
defineProps<{ modelValue: 'and' | 'or' }>()
const emit = defineEmits<{ 'update:modelValue': [v: 'and' | 'or'] }>()
</script>

<template>
  <div class="combinator-toggle" data-testid="combinator-toggle" role="group" aria-label="匹配逻辑">
    <button
      type="button"
      :class="{ active: modelValue === 'and' }"
      data-testid="combinator-and"
      @click="emit('update:modelValue', 'and')"
    >且 (all)</button>
    <button
      type="button"
      :class="{ active: modelValue === 'or' }"
      data-testid="combinator-or"
      @click="emit('update:modelValue', 'or')"
    >或 (any)</button>
  </div>
</template>

<style scoped>
.combinator-toggle {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.combinator-toggle button {
  border: none;
  background: var(--bg-base);
  color: var(--text-secondary);
  padding: 4px 10px;
  font-size: var(--text-xs);
  font-family: inherit;
  cursor: pointer;
}
.combinator-toggle button.active {
  background: var(--accent);
  color: #fff;
}
</style>
