<script setup lang="ts">
/**
 * SegmentedControl —— 互斥单选分段控制（通用 primitive）。
 *
 * radiogroup 语义 + 方向键循环导航（WAI-ARIA）；激活档 tabindex=0 其余 -1
 * （roving tabindex）。样式走 mini 控件配方（bg-base2 底 + accent 激活档），
 * 适用场景：选项封闭 ≤5 且容器宽度可容纳全部档位 —— 超出请回退下拉。
 */
const props = defineProps<{
  options: { value: string; label: string }[]
  modelValue: string
  disabled?: boolean
  ariaLabel?: string
}>()

const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

function onKeydown(e: KeyboardEvent) {
  const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
  if (!delta || props.options.length < 2) return
  e.preventDefault()
  const idx = props.options.findIndex((o) => o.value === props.modelValue)
  const next = props.options[(idx + delta + props.options.length) % props.options.length]
  if (next) emit('update:modelValue', next.value)
}
</script>

<template>
  <div
    class="seg-control"
    role="radiogroup"
    :aria-label="ariaLabel"
    :aria-disabled="disabled || undefined"
    @keydown="onKeydown"
  >
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      role="radio"
      class="seg-item"
      :class="{ 'seg-item--active': o.value === modelValue }"
      :aria-checked="o.value === modelValue"
      :tabindex="o.value === modelValue ? 0 : -1"
      :disabled="disabled"
      @click="emit('update:modelValue', o.value)"
    >
      {{ o.label }}
    </button>
  </div>
</template>

<style scoped lang="scss">
.seg-control {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  background: var(--bg-base2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  max-width: 100%;
}

.seg-item {
  padding: 2px var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--radius-xs);
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);

  &:hover:not(:disabled):not(.seg-item--active) {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  &--active {
    color: var(--text-primary);
    background: var(--accent-40);
  }

  &:focus-visible {
    outline: none;
    border-color: var(--accent-40);
    box-shadow: 0 0 0 1px var(--accent-40);
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
}
</style>
