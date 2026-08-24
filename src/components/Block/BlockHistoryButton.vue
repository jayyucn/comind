<script setup lang="ts">
import { ref, computed } from 'vue'
import { History } from 'lucide-vue-next'

const props = defineProps<{
  blockId: string
}>()

const emit = defineEmits<{
  (e: 'open'): void
}>()

const isHovered = ref(false)

const buttonClass = computed(() => ({
  'block-history-button': true,
  'is-hovered': isHovered.value
}))
</script>

<template>
  <button
    :class="buttonClass"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
    @click.stop="emit('open')"
    title="查看历史版本"
  >
    <History :size="14" />
  </button>
</template>

<style scoped lang="scss">
.block-history-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  background: transparent;
  border: none;
  color: var(--text-muted, #9ca3af);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, background-color 0.15s ease, color 0.15s ease;

  &:hover,
  &.is-hovered {
    opacity: 1;
    background-color: var(--bg-hover, rgba(0, 0, 0, 0.05));
    color: var(--text-primary, #1f2937);
  }
}
</style>