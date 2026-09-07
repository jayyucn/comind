<script setup lang="ts">
// 写笔记简易输入浮层（票 06 / ADR-0040 D4）：v1 纯文本输入，非块编辑器
// （阅读器不内嵌编辑器，D4）。高亮操作条/高亮浮层点「写笔记」后浮现。
// 外壳复用 BasePopover（ADR-0038）：Teleport + overlay 点外关闭 + Escape +
// 定位收边 + 面板外观，此处不再自绘重复样板；(x, y) 沿用顶边中点语义，
// 折算成 BasePopover 需要的面板左上角坐标，观感与旧 translate(-50%, 12px) 一致。
import { computed, nextTick, ref, watch } from 'vue'
import BasePopover from '../common/BasePopover.vue'

const props = defineProps<{
  visible: boolean
  /** 视口坐标（打开入口的位置，浮层以它为顶边中点向下展开） */
  x: number
  y: number
  /** 编辑已有笔记时预填的旧文本 */
  initialText?: string
}>()

const emit = defineEmits<{
  submit: [text: string]
  close: []
}>()

const text = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)

/** 面板宽（与 .note-input-popover 宽度联动），折算半宽用 */
const POPOVER_W = 320
/** 面板与入口的纵向间隙（对应旧 transform 的 12px 下移） */
const GAP_Y = 12
const panelPosition = computed(() => ({
  x: props.x - POPOVER_W / 2,
  y: props.y + GAP_Y,
}))

watch(
  () => props.visible,
  async visible => {
    if (visible) {
      text.value = props.initialText ?? ''
      await nextTick()
      textareaRef.value?.focus()
    }
  },
  { immediate: true },
)

/** 空文本不可提交 */
function submit(): void {
  const value = text.value.trim()
  if (!value) return
  emit('submit', value)
}

function onKeydown(e: KeyboardEvent): void {
  // Ctrl/Cmd+Enter 提交（Enter 留给换行；Escape 关闭由 BasePopover 处理）
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    submit()
  }
}
</script>

<template>
  <BasePopover :visible="visible" :position="panelPosition" @close="emit('close')">
    <div class="note-input-popover" :style="{ width: `${POPOVER_W}px` }">
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
  </BasePopover>
</template>

<style lang="scss" scoped>
.note-input-popover {
  // 外壳外观（背景/边框/阴影/定位）由 BasePopover 提供，这里只留内容布局
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-sizing: border-box;
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
