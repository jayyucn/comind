<script setup lang="ts">
import { INLINE_COLORS } from '../utils/inline-marks'

/**
 * 行内格式的取色面板：字体色 + 背景色两段。
 *
 * 抽成独立组件是因为两处宿主不同、面皮一致：
 * - `InlineFormatToolbar`（正文文本选区工具条）；
 * - 表格的选区浮层（`TableBlock`）。
 * 两个宿主都把它塞进同一个 `FloatingSubmenu`（挂在触发按钮上方、Esc 只关二级），
 * 面板本身只管「画格子 + 报选中」，位置与层级全部由宿主决定。
 *
 * 类名沿用 `inline-format-*`：它就是这个面板的既有视觉语言，换成新前缀只会让
 * 两个宿主各长一套同形不同名的样式。
 */
const props = defineProps<{
  color?: string
  background?: string
}>()

const emit = defineEmits<{
  (e: 'apply', kind: 'color' | 'background', token: string | null): void
  (e: 'reset'): void
}>()
</script>

<template>
  <div class="inline-color-palette">
    <div
      class="inline-format-palette-section"
      data-kind="color"
    >
      <div class="inline-format-palette-label">
        字体颜色
      </div>
      <div class="inline-format-palette-grid">
        <button
          type="button"
          class="inline-format-swatch inline-format-swatch--text inline-format-swatch--default"
          :class="{ 'is-active': !props.color }"
          title="默认颜色"
          @click="emit('apply', 'color', null)"
        >
          A
        </button>
        <button
          v-for="entry in INLINE_COLORS"
          :key="entry.token"
          type="button"
          class="inline-format-swatch inline-format-swatch--text"
          :class="{ 'is-active': props.color === entry.token }"
          :style="{ color: `var(${entry.token})` }"
          :title="entry.label"
          @click="emit('apply', 'color', entry.token)"
        >
          A
        </button>
      </div>
    </div>

    <div
      class="inline-format-palette-section"
      data-kind="background"
    >
      <div class="inline-format-palette-label">
        背景颜色
      </div>
      <div class="inline-format-palette-grid">
        <button
          type="button"
          class="inline-format-swatch inline-format-swatch--none"
          :class="{ 'is-active': !props.background }"
          title="无背景色"
          @click="emit('apply', 'background', null)"
        />
        <button
          v-for="entry in INLINE_COLORS"
          :key="entry.token"
          type="button"
          class="inline-format-swatch"
          :class="{ 'is-active': props.background === entry.token }"
          :style="{ backgroundColor: `var(${entry.token})` }"
          :title="entry.label"
          @click="emit('apply', 'background', entry.token)"
        />
      </div>
    </div>

    <button
      type="button"
      class="inline-format-reset"
      title="清除文字色与背景色"
      @click="emit('reset')"
    >
      恢复默认
    </button>
  </div>
</template>

<style scoped>
.inline-color-palette {
  min-width: 176px;
  padding: 8px;
}

.inline-format-palette-label {
  margin-bottom: 6px;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.inline-format-palette-section + .inline-format-palette-section {
  margin-top: 8px;
}

.inline-format-palette-grid {
  display: grid;
  grid-template-columns: repeat(6, 20px);
  gap: 6px;
}

.inline-format-swatch {
  width: 20px;
  height: 20px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.inline-format-swatch.is-active {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

/* 字体色块用字面 "A" 展示颜色，无填充底 */
.inline-format-swatch--text {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-color: transparent;
  background: transparent;
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  line-height: 1;
}

.inline-format-swatch--text:hover {
  background: var(--bg-hover);
}

.inline-format-swatch--none {
  background:
    linear-gradient(to top right, transparent calc(50% - 1px), var(--border-strong) calc(50% - 1px), var(--border-strong) calc(50% + 1px), transparent calc(50% + 1px)),
    var(--bg-base);
}

.inline-format-reset {
  width: 100%;
  margin-top: 10px;
  padding: 4px 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  line-height: 1.4;
  cursor: pointer;
}

.inline-format-reset:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
</style>
