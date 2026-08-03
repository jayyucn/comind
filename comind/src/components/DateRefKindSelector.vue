<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import type { DateRefKind } from '../utils/date-ref'

const props = defineProps<{
  visible: boolean
  position: { left: number; top: number; bottom: number }
}>()

const emit = defineEmits<{
  select: [kind: DateRefKind]
  cancel: []
}>()

const selectedIndex = ref(0)
const items: { kind: DateRefKind; label: string; icon: string }[] = [
  { kind: 'ref', label: '日期引用', icon: '🗓️' },
  { kind: 'schedule', label: '计划时间', icon: '📅' },
  { kind: 'deadline', label: '截止时间', icon: '⏰' },
]

function onKeyDown(e: KeyboardEvent) {
  if (!props.visible) return
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('cancel')
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = (selectedIndex.value + 1) % items.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = (selectedIndex.value - 1 + items.length) % items.length
  } else if (e.key === 'Enter') {
    e.preventDefault()
    emit('select', items[selectedIndex.value].kind)
  }
}

onMounted(() => document.addEventListener('keydown', onKeyDown, true))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeyDown, true))
</script>

<template>
  <Teleport to="body">
    <Transition name="kind-fade">
      <div
        v-if="visible"
        class="kind-overlay"
        @click.self="emit('cancel')"
      >
        <div
          class="kind-menu"
          :style="{ left: `${position.left}px`, top: `${position.bottom + 4}px` }"
          @click.stop
        >
          <button
            v-for="(item, i) in items"
            :key="item.kind"
            class="kind-item"
            :class="{ 'kind-item--active': i === selectedIndex }"
            @click="emit('select', item.kind)"
            @mouseenter="selectedIndex = i"
          >
            <span class="kind-icon">{{ item.icon }}</span>
            <span class="kind-label">{{ item.label }}</span>
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.kind-overlay {
  position: fixed;
  inset: 0;
  z-index: 1099;
  background: transparent;
}

.kind-menu {
  position: fixed;
  z-index: 1100;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-modal);
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 140px;
}

.kind-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: none;
  background: none;
  cursor: pointer;
  border-radius: var(--radius-xs);
  font-family: inherit;
  font-size: var(--text-sm);
  color: var(--text-primary);
  transition: background var(--transition-fast);

  &:hover,
  &--active {
    background: var(--bg-hover);
  }
}

.kind-icon {
  font-size: var(--text-sm);
  line-height: 1;
}

.kind-label {
  font-weight: var(--font-normal);
}

.kind-fade-enter-active,
.kind-fade-leave-active {
  transition: opacity var(--transition-fast), transform var(--transition-fast);
}

.kind-fade-enter-from,
.kind-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
