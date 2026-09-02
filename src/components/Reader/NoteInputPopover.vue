<script setup lang="ts">
// 写笔记简易输入浮层（票 06 / ADR-0040 D4）：v1 纯文本输入，非块编辑器
// （阅读器不内嵌编辑器，D4）。高亮操作条/高亮浮层点「写笔记」后浮现，
// 展示高亮原文作上下文 + 输入想法。Teleport 到 body + var(--z-popover)
// （ADR-0032 浮层纪律）；点外关闭（与 HighlightPopover 同一模式）。
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  visible: boolean
  /** 视口坐标（打开入口的位置） */
  x: number
  y: number
  /** 高亮原文（只读上下文展示） */
  quote?: string
  /** 编辑已有笔记时预填的旧文本 */
  initialText?: string
}>()

const emit = defineEmits<{
  submit: [text: string]
  close: []
}>()

const text = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)

watch(
  () => props.visible,
  async visible => {
    if (visible) {
      text.value = props.initialText ?? ''
      document.addEventListener('mousedown', onDocMouseDown)
      await nextTick()
      textareaRef.value?.focus()
    } else {
      document.removeEventListener('mousedown', onDocMouseDown)
    }
  },
  { immediate: true },
)

/** 点浮层外关闭 */
function onDocMouseDown(e: MouseEvent): void {
  const target = e.target as HTMLElement | null
  if (!target) return
  if (target.closest('.note-input-popover')) return
  emit('close')
}

/** 空文本不可提交 */
function submit(): void {
  const value = text.value.trim()
  if (!value) return
  emit('submit', value)
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    emit('close')
    return
  }
  // Ctrl/Cmd+Enter 提交（Enter 留给换行）
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    submit()
  }
}

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMouseDown)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="note-input-popover"
      :style="{ left: `${x}px`, top: `${y}px` }"
      role="dialog"
      aria-label="写笔记"
    >
      <p v-if="quote" class="quote" :title="quote">“{{ quote }}”</p>
      <textarea
        ref="textareaRef"
        v-model="text"
        class="note-input"
        rows="3"
        placeholder="写下你的想法…"
        @keydown="onKeydown"
      ></textarea>
      <div class="actions">
        <span class="hint">Ctrl+Enter 保存</span>
        <button class="btn cancel" @click="emit('close')">取消</button>
        <button class="btn primary" @click="submit">保存</button>
      </div>
    </div>
  </Teleport>
</template>

<style lang="scss" scoped>
.note-input-popover {
  position: fixed;
  // 以 (x,y) 为顶边中点向下展开（入口是选区上方/点击处）
  transform: translate(-50%, 12px);
  z-index: var(--z-popover);
  width: 320px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-modal);
}

.quote {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.note-input {
  resize: vertical;
  min-height: 60px;
  max-height: 240px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-family: inherit;
  line-height: 1.5;

  &:focus {
    outline: none;
    border-color: var(--accent);
  }
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
}

.hint {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  margin-right: auto;
}

.btn {
  border: 1px solid var(--border);
  background: transparent;
  cursor: pointer;
  height: 26px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  transition: all 100ms ease;

  &:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  &.primary {
    border-color: var(--accent);
    color: var(--accent);

    &:hover:not(:disabled) {
      background: var(--accent-08, rgba(59, 130, 246, 0.08));
    }
  }

  &:disabled {
    color: var(--text-disabled);
    cursor: default;
  }
}
</style>
