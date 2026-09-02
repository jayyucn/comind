<script setup lang="ts">
// 排版控制面板（票 04 / ADR-0040 D6/D10）：字号/行距/行宽步进 + 三主题。
// 浮层纪律（ADR-0032）：Teleport 到 body + var(--z-popover)，避免困在阅读器
// 滚动容器的局部堆叠上下文。状态直接取 useReaderTypography 模块单例，
// 与 ReaderView 共享同一份响应式状态（CSS 变量由 ReaderView 落地到窗口根）。
import { onBeforeUnmount, watch } from 'vue';
import type { ReaderTheme } from '../../composables/useReaderTypography';
import { ReaderContentMaxWidth, ReaderContentMinWidth, useReaderTypography } from '../../composables/useReaderTypography';

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const { typography, stepFontSize, stepLineHeight, stepMaxWidth, updateTypography } =
  useReaderTypography()

const THEME_OPTIONS: { value: ReaderTheme; label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'sepia', label: '护眼' },
  { value: 'dark', label: '夜间' },
]

/** 点面板外关闭（排版触发按钮除外，由其自身 toggle 开合） */
function onDocMouseDown(e: MouseEvent): void {
  const target = e.target as HTMLElement | null
  if (!target) return
  if (target.closest('.typography-panel') || target.closest('.reader-typography-toggle')) return
  emit('close')
}

watch(
  () => props.open,
  open => {
    if (open) document.addEventListener('mousedown', onDocMouseDown)
    else document.removeEventListener('mousedown', onDocMouseDown)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMouseDown)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="typography-panel" role="dialog" aria-label="排版设置">
      <div class="panel-row">
        <span class="row-label">字号</span>
        <button class="step-btn" title="减小字号" :disabled="typography.fontSize <= 14"
          @click="stepFontSize(-1)">−</button>
        <span class="row-value">{{ typography.fontSize }}px</span>
        <button class="step-btn" title="增大字号" :disabled="typography.fontSize >= 24"
          @click="stepFontSize(1)">＋</button>
      </div>
      <div class="panel-row">
        <span class="row-label">行距</span>
        <button class="step-btn" title="减小行距" :disabled="typography.lineHeight <= 1.4"
          @click="stepLineHeight(-1)">−</button>
        <span class="row-value">{{ typography.lineHeight.toFixed(1) }}</span>
        <button class="step-btn" title="增大行距" :disabled="typography.lineHeight >= 2.4"
          @click="stepLineHeight(1)">＋</button>
      </div>
      <div class="panel-row">
        <span class="row-label">行宽</span>
        <button class="step-btn" title="收窄行宽" :disabled="typography.maxWidthCh <= ReaderContentMinWidth"
          @click="stepMaxWidth(-1)">−</button>
        <span class="row-value">{{ typography.maxWidthCh }}ch</span>
        <button class="step-btn" title="加宽行宽" :disabled="typography.maxWidthCh >= ReaderContentMaxWidth"
          @click="stepMaxWidth(1)">＋</button>
      </div>
      <div class="panel-row theme-row">
        <span class="row-label">主题</span>
        <button
          v-for="option in THEME_OPTIONS"
          :key="option.value"
          class="theme-btn"
          :class="{ active: typography.theme === option.value }"
          @click="updateTypography({ theme: option.value })"
        >{{ option.label }}</button>
      </div>
    </div>
  </Teleport>
</template>

<style lang="scss" scoped>
.typography-panel {
  position: fixed;
  top: calc(var(--nav-height) + 8px);
  right: 12px;
  width: 232px;
  z-index: var(--z-popover);
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-modal);
}

.panel-row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
}

.row-label {
  flex: 1;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.row-value {
  min-width: 52px;
  text-align: center;
  font-size: var(--text-sm);
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.step-btn {
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  font-size: var(--text-base);
  color: var(--text-secondary);
  transition: all 100ms ease;

  &:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  &:disabled {
    color: var(--text-disabled);
    cursor: default;
  }
}

.theme-row {
  gap: 4px;
}

.theme-btn {
  flex: 1;
  height: 26px;
  border: 1px solid var(--border);
  background: transparent;
  cursor: pointer;
  border-radius: var(--radius-md);
  font-size: var(--text-xs);
  color: var(--text-secondary);
  transition: all 100ms ease;

  &:hover {
    border-color: var(--border-strong);
    color: var(--text-primary);
  }

  &.active {
    border-color: var(--accent);
    color: var(--accent);
    font-weight: var(--font-medium);
  }
}
</style>
