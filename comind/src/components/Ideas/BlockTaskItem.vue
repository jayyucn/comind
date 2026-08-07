<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { useBlockStore } from '../../stores/blocks'
import { usePropertyStore } from '../../stores/property'
import { useContentRenderer } from '../../composables/useContentRenderer'
import { parseDateRefs, formatIsoDisplay } from '../../utils/date-ref'
import type { IncompleteTask } from '../../wasm/types'
import PropertyInline from '../Block/PropertyInline.vue'

const props = defineProps<{
  task: IncompleteTask
}>()

const emit = defineEmits<{
  navigate: [pageId: string, pageTitle: string]
}>()

const blockStore = useBlockStore()
const propertyStore = usePropertyStore()
const { renderContentToHtml } = useContentRenderer()

const isEditing = ref(false)
const editContent = ref('')
const editRef = ref<HTMLElement | null>(null)

// 加载 property（status 等）
onMounted(async () => {
  await propertyStore.loadBlockProperties(props.task.id)
})

// 确保 block 在 blockStore 内存中（编辑需要）
async function ensureBlockInStore() {
  if (!blockStore.getBlock(props.task.id)) {
    await blockStore.loadBlock(props.task.id)
  }
}

const status = computed(() => {
  return propertyStore.getBlockProperty(props.task.id, 'status')?.value as string | undefined
})

const dateRefs = computed(() => parseDateRefs(props.task.content))
const deadlineRef = computed(() => dateRefs.value.find(r => r.kind === 'deadline'))
const scheduleRef = computed(() => dateRefs.value.find(r => r.kind === 'schedule'))

const isOverdue = computed(() => {
  if (!deadlineRef.value) return false
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return deadlineRef.value.iso < todayStr
})

const renderedContent = computed(() => renderContentToHtml(props.task.content, props.task.id))

async function startEdit() {
  await ensureBlockInStore()
  editContent.value = props.task.content
  isEditing.value = true
  await nextTick()
  editRef.value?.focus()
  // 将光标放到末尾
  const range = document.createRange()
  const sel = window.getSelection()
  if (editRef.value && sel) {
    range.selectNodeContents(editRef.value)
    range.collapse(false)
    sel.removeAllRanges()
    sel.addRange(range)
  }
}

async function saveEdit() {
  if (!isEditing.value) return
  isEditing.value = false
  const newContent = editContent.value
  if (newContent !== props.task.content) {
    await blockStore.updateBlockContent(props.task.id, newContent)
  }
}

function handleBlur() {
  saveEdit()
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    saveEdit()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    isEditing.value = false
  } else if (e.key === 'Backspace') {
    // Backspace 空内容 + 有 status → 清除 status
    const currentText = editRef.value?.textContent || ''
    if (currentText.length === 0 && status.value) {
      e.preventDefault()
      propertyStore.setProperty(props.task.id, 'status', '')
      // 退出编辑态（block 会从列表消失）
      isEditing.value = false
    }
  }
}

function handleInput() {
  if (editRef.value) {
    editContent.value = editRef.value.textContent || ''
  }
}

function handleNavigate() {
  emit('navigate', props.task.page_id, props.task.page_title)
}

function handleDateClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.classList.contains('date-ref')) {
    e.stopPropagation()
    handleNavigate()
  }
}

function handleContentClick() {
  if (!isEditing.value) {
    startEdit()
  }
}
</script>

<template>
  <div class="block-task-item" :class="{ overdue: isOverdue }">
    <!-- status 图标 -->
    <div class="task-status" @click.stop>
      <PropertyInline :block-id="task.id" position="between-bullet-content" />
    </div>

    <!-- 内容区 -->
    <div class="task-content" @click="handleContentClick">
      <!-- 编辑态 -->
      <div
        v-if="isEditing"
        ref="editRef"
        class="task-editor"
        contenteditable="true"
        @blur="handleBlur"
        @keydown="handleKeydown"
        @input="handleInput"
        v-text="editContent"
      />

      <!-- 渲染态 -->
      <div
        v-else
        class="task-render"
        @click="handleDateClick"
        v-html="renderedContent"
      />
    </div>

    <!-- 日期标签 -->
    <div class="task-dates" @click.stop="handleNavigate">
      <span
        v-if="deadlineRef"
        class="date-tag deadline"
        :class="{ overdue: isOverdue }"
      >
        ⏰ {{ formatIsoDisplay(deadlineRef.iso) }}
      </span>
      <span
        v-if="scheduleRef"
        class="date-tag schedule"
      >
        📅 {{ formatIsoDisplay(scheduleRef.iso) }}
      </span>
    </div>

    <!-- 来源页面 -->
    <div class="task-source" @click.stop="handleNavigate">
      {{ task.page_title }}
    </div>
  </div>
</template>

<style lang="scss" scoped>
.block-task-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 120ms;

  &:hover {
    background-color: var(--app-hover, rgba(0, 0, 0, 0.04));
  }
}

.task-status {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  min-height: 24px;
}

.task-content {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  line-height: 1.5;
  word-break: break-word;
}

.task-editor {
  outline: none;
  min-height: 1.3em;
  padding: 0 4px;
  white-space: pre-wrap;
  word-break: break-word;
}

.task-render {
  :deep(.date-ref) {
    cursor: pointer;
  }
}

.task-dates {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-end;
}

.date-tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  white-space: nowrap;

  &.deadline {
    color: #d97706;
    background: rgba(217, 119, 6, 0.08);

    &.overdue {
      color: #dc2626;
      background: rgba(220, 38, 38, 0.08);
    }
  }

  &.schedule {
    color: #0284c7;
    background: rgba(2, 132, 199, 0.08);
  }
}

.task-source {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--app-text-tertiary, #9ca3af);
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;

  &:hover {
    color: var(--app-text-secondary, #6b7280);
  }
}
</style>
