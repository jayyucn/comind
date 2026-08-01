<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  page: any
  active?: boolean
  showTime?: boolean
  timeFormat?: 'relative' | 'absolute'
  isRenaming?: boolean
}>(), {
  active: false,
  showTime: true,
  timeFormat: 'relative',
  isRenaming: false
})

const emit = defineEmits<{
  click: []
  rename: [newTitle: string]
  cancelRename: []
}>()

const localRenaming = ref(false)
const newTitle = ref('')
const inputRef = ref<HTMLInputElement>()

watch(() => props.isRenaming, (val) => {
  localRenaming.value = val
  if (val) {
    newTitle.value = props.page.title
    setTimeout(() => {
      inputRef.value?.focus()
      inputRef.value?.select()
    }, 0)
  }
})

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
  if (diff < hour) return `${Math.floor(diff / minute)}min`
  if (diff < 2 * hour) return '1h'
  if (diff < day) return `${Math.floor(diff / hour)}h`
  if (diff < 2 * day) return '昨天'

  const d = new Date(timestamp)
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}`
}

function handleConfirm() {
  if (newTitle.value.trim() && newTitle.value !== props.page.title) {
    emit('rename', newTitle.value.trim())
  }
  emit('cancelRename')
  localRenaming.value = false
}

function handleCancel() {
  newTitle.value = ''
  emit('cancelRename')
  localRenaming.value = false
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault()
    handleConfirm()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    handleCancel()
  }
}
</script>

<template>
  <div
    class="page-item"
    :class="{ active }"
    tabindex="0"
    @click="!localRenaming && emit('click')"
    @keydown.enter="!localRenaming && emit('click')"
  >
    <input
      v-if="localRenaming"
      ref="inputRef"
      v-model="newTitle"
      class="page-item-input"
      @blur="handleConfirm"
      @keydown="handleKeydown"
    />
    <span v-else class="page-item-title">{{ page.title }}</span>
    <span v-if="showTime && !localRenaming" class="page-time">{{ timeDisplay }}</span>
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
  border-radius: 6px;
  position: relative;
  height: 30px;
  box-sizing: border-box;
  transition: background 80ms ease;
}

.page-item:hover {
  background: var(--bg-hover);
}

.page-item.active {
  background: var(--accent-bg, rgba(99, 102, 241, 0.08));
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

.page-item-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--text-primary);
  line-height: var(--leading-snug);
}

.page-time {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  flex-shrink: 0;
  line-height: var(--leading-snug);
}

.page-item-input {
  flex: 1;
  min-width: 0;
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--text-primary);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 2px 4px;
  outline: none;
  font-family: inherit;
}

.page-item-input:focus {
  border-color: var(--accent);
}
</style>
