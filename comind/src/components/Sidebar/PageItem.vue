<script setup lang="ts">
import { computed } from 'vue'
import { FileText } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  page: any
  active?: boolean
  showTime?: boolean
  timeFormat?: 'relative' | 'absolute'
}>(), {
  active: false,
  showTime: true,
  timeFormat: 'relative'
})

const emit = defineEmits<{
  click: []
}>()

const timeDisplay = computed(() => {
  if (!props.showTime) return ''
  return formatTime(props.page.updatedAt, props.timeFormat)
})

function formatTime(timestamp: number, format: 'relative' | 'absolute'): string {
  if (format === 'absolute') {
    const d = new Date(timestamp)
    return `${d.getMonth() + 1}月${d.getDate()}日`
  }

  const now = Date.now()
  const diff = now - timestamp
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} min前`
  if (diff < 2 * hour) return '1 h前'
  if (diff < day) return `${Math.floor(diff / hour)} h前`
  if (diff < 2 * day) return '昨天'

  const d = new Date(timestamp)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}
</script>

<template>
  <div
    class="page-item"
    :class="{ active }"
    tabindex="0"
    @click="emit('click')"
    @keydown.enter="emit('click')"
  >
    <span class="page-icon">
      <FileText :size="14" :stroke-width="1.75" />
    </span>
    <span class="page-title">{{ page.title }}</span>
    <span v-if="showTime" class="page-time">{{ timeDisplay }}</span>
    <slot name="suffix" />
  </div>
</template>

<style scoped>
.page-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  cursor: pointer;
  border-radius: 8px;
  position: relative;
  height: 32px;
  box-sizing: border-box;
  transition: background 80ms ease;
}

.page-item:hover {
  background: var(--bg-hover);
}

.page-item.active {
  background: var(--accent-bg);
}

.page-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 5px;
  bottom: 5px;
  width: 2px;
  background: var(--accent);
  border-radius: 1px;
}

.page-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--sidebar-text-hint);
  flex-shrink: 0;
}

.page-item.active .page-icon {
  color: var(--accent);
}

.page-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 500;
  color: var(--sidebar-text-primary);
  line-height: 1.4;
}

.page-time {
  font-size: 11px;
  color: var(--sidebar-text-hint);
  flex-shrink: 0;
  line-height: 1.4;
}
</style>