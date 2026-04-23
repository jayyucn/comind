<script setup lang="ts">
import { computed } from 'vue'

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
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < 2 * hour) return '1 小时前'
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
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
    <span class="page-icon">📄</span>
    <span class="page-title">{{ page.title }}</span>
    <span v-if="showTime" class="page-time">{{ timeDisplay }}</span>
  </div>
</template>

<style scoped>
.page-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
  border-radius: 5px;
  transition: none;
  position: relative;
  height: 32px;
  box-sizing: border-box;
}

.page-item:hover {
  background: var(--bg-hover);
}

.page-item.active {
  background: var(--bg-active);
}

.page-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 2px;
  background: var(--accent);
  border-radius: 1px;
}

.page-icon {
  font-size: 14px;
  flex-shrink: 0;
  line-height: 1;
}

.page-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 400;
}

.page-time {
  font-size: 12px;
  color: var(--text-secondary);
  flex-shrink: 0;
  font-weight: 400;
}
</style>