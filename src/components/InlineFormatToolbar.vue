<script setup lang="ts">
import type { Editor } from '@tiptap/core'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { SelectionRect } from '../services/selection-geometry'
import type { TextRange } from '../services/text-range'
import type { InlineMarkAttrs, InlineMarkKey } from '../utils/inline-marks'
import { INLINE_COLORS } from '../utils/inline-marks'

const props = defineProps<{
  editor?: Editor | null | undefined
  /** 编辑器选区/内容版本号：驱动按钮激活态与浮层位置重算 */
  revision?: number
  /** 跨块文本选区：存在时进入「范围模式」，不依赖编辑器（编辑器此时已失活） */
  range?: TextRange | null
  /** 外部选区模式（如表格单元格内的原生文本选区）：不依赖编辑器，格式/矩形由使用方传入 */
  detached?: boolean
  /** 范围模式下的选区矩形（取选区首行），用于浮层定位 */
  rangeRect?: SelectionRect | null
  /** 范围模式下选区的合并格式（驱动按钮激活态） */
  rangeFormat?: InlineMarkAttrs | null
}>()

const emit = defineEmits<{
  (e: 'apply-range', key: InlineMarkKey, token: string | null): void
}>()

const visible = ref(false)
const position = ref({ left: 0, top: 0 })
const picker = ref(false)
const toolbarEl = ref<HTMLElement | null>(null)

/** 首帧尚未挂载时的兜底尺寸（真实尺寸在 nextTick 后补测） */
const FALLBACK_WIDTH = 236
const FALLBACK_HEIGHT = 34

const state = computed(() => {
  // 范围模式：选区由 BlockList 持有（编辑器已失活），格式来自 store 的合并结果
  if (props.range || props.detached) {
    const attrs = props.rangeFormat ?? {}
    return {
      bold: attrs.bold === true,
      italic: attrs.italic === true,
      underline: attrs.underline === true,
      strike: attrs.strike === true,
      color: attrs.color ?? '',
      background: attrs.background ?? '',
      focused: true,
      from: 0,
      to: 0,
    }
  }
  // 订阅 revision：TipTap 的 isActive / 选区不是 Vue 响应式数据
  void props.revision
  const editor = props.editor
  if (!editor) return null
  const { from, to } = editor.state.selection
  if (from === to) return null
  return {
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    underline: editor.isActive('underline'),
    strike: editor.isActive('strike'),
    color: (editor.getAttributes('inlineTextColor').color as string | null) ?? '',
    background: (editor.getAttributes('inlineBackgroundColor').color as string | null) ?? '',
    focused: editor.isFocused,
    from,
    to,
  }
})

/** 合并色按钮：字形取文字色，按钮底色取背景色（与正文渲染同口径的 28% 淡染） */
const colorButtonStyle = computed<Record<string, string>>(() => {
  const info = state.value
  const style: Record<string, string> = {}
  if (info?.color) style.color = `var(${info.color})`
  if (info?.background) style.background = `color-mix(in srgb, var(${info.background}) 28%, transparent)`
  return style
})

function hide() {
  visible.value = false
  picker.value = false
}

function updatePosition() {
  const info = state.value
  if (!info) {
    hide()
    return
  }

  let centerX: number
  let anchorTop: number
  if (props.range || props.detached) {
    const rect = props.rangeRect
    if (!rect) {
      hide()
      return
    }
    centerX = rect.left + rect.width / 2
    anchorTop = rect.top
  } else {
    const editor = props.editor
    if (!editor || !info.focused) {
      hide()
      return
    }
    const docSize = editor.state.doc.content.size
    // 端点钳进正文文本区间 [1, docSize-1]：Ctrl+A 的 from=0 / to=docSize 落在段落节点边界，
    // coordsAtPos 会返回整行行盒（0 高、宽到内容区右缘），横向中心被拉到行中间，
    // 短文本时工具条明显偏离文字上方。
    const clampPos = (pos: number) => Math.min(Math.max(pos, 1), Math.max(1, docSize - 1))
    const start = editor.view.coordsAtPos(clampPos(info.from))
    // to 用 side=-1（取该位置之前的字符矩形），选区止于字符边界时拿到结尾而非下一个行盒
    const end = editor.view.coordsAtPos(clampPos(info.to), -1)
    centerX = (start.left + end.right) / 2
    anchorTop = Math.min(start.top, end.top)
  }

  const width = toolbarEl.value?.offsetWidth || FALLBACK_WIDTH
  const height = toolbarEl.value?.offsetHeight || FALLBACK_HEIGHT
  const left = Math.min(Math.max(8, centerX - width / 2), window.innerWidth - width - 8)
  // translateY(-100%) 上翻：top 至少留出自身高度，避免选区贴近视口顶部时被裁掉
  const top = Math.max(height + 8, anchorTop - 10)
  position.value = { left, top }
  visible.value = true
}

watch(
  () => [props.revision, props.editor, props.range, props.detached, props.rangeRect, props.rangeFormat],
  updatePosition,
  { immediate: true },
)

// 浮层用 v-if 渲染，首次显示时量不到真实尺寸（offsetWidth=0 走兜底值 → 位置偏移）。
// 挂载后再测一次，用真实宽高重新定位。
watch(visible, async (value) => {
  if (!value) return
  await nextTick()
  if (visible.value && toolbarEl.value?.offsetWidth) updatePosition()
})

function toggleMark(name: 'bold' | 'italic' | 'underline' | 'strike') {
  if (props.range || props.detached) {
    emit('apply-range', name, null)
    return
  }
  const editor = props.editor
  if (!editor) return
  editor.chain().focus().toggleMark(name).run()
  updatePosition()
}

/** 选色后浮层保持打开：字体色与背景色在同一面板里连续调整，避免反复展开 */
function applyColor(kind: 'color' | 'background', token: string | null) {
  if (props.range || props.detached) {
    emit('apply-range', kind, token)
    return
  }
  const editor = props.editor
  if (!editor) return
  const markName = kind === 'color' ? 'inlineTextColor' : 'inlineBackgroundColor'
  const current = editor.getAttributes(markName).color as string | null | undefined
  if (token && current !== token) {
    editor.chain().focus().setMark(markName, { color: token }).run()
  } else {
    editor.chain().focus().unsetMark(markName).run()
  }
  updatePosition()
}

/** 同时清除文字色与背景色 */
function resetColors() {
  if (props.range || props.detached) {
    emit('apply-range', 'color', null)
    emit('apply-range', 'background', null)
    return
  }
  const editor = props.editor
  if (!editor) return
  editor.chain().focus().unsetMark('inlineTextColor').unsetMark('inlineBackgroundColor').run()
  updatePosition()
}

function togglePicker() {
  picker.value = !picker.value
}

function hideOnScroll() {
  visible.value = false
  picker.value = false
}

onMounted(() => {
  window.addEventListener('scroll', hideOnScroll, true)
  window.addEventListener('resize', hideOnScroll)
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', hideOnScroll, true)
  window.removeEventListener('resize', hideOnScroll)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible && state"
      ref="toolbarEl"
      class="inline-format-toolbar"
      :style="{ left: `${position.left}px`, top: `${position.top}px` }"
      @mousedown.prevent
    >
      <button
        type="button"
        class="inline-format-button"
        :class="{ 'is-active': state.bold }"
        title="加粗 (Ctrl+B)"
        @click="toggleMark('bold')"
      >
        <strong>B</strong>
      </button>
      <button
        type="button"
        class="inline-format-button"
        :class="{ 'is-active': state.italic }"
        title="斜体 (Ctrl+I)"
        @click="toggleMark('italic')"
      >
        <em>I</em>
      </button>
      <button
        type="button"
        class="inline-format-button"
        :class="{ 'is-active': state.underline }"
        title="下划线 (Ctrl+U)"
        @click="toggleMark('underline')"
      >
        <span class="underline-icon">U</span>
      </button>
      <button
        type="button"
        class="inline-format-button"
        :class="{ 'is-active': state.strike }"
        title="删除线 (Ctrl+Shift+X)"
        @click="toggleMark('strike')"
      >
        <s>S</s>
      </button>
      <span class="inline-format-divider" />
      <button
        type="button"
        class="inline-format-button inline-format-button--color"
        :class="{ 'is-active': !!state.color || !!state.background, 'is-open': picker }"
        :style="colorButtonStyle"
        title="文字颜色与背景色"
        @click="togglePicker"
      >
        <span class="color-icon">A</span>
      </button>

      <div
        v-if="picker"
        class="inline-format-palette"
      >
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
              :class="{ 'is-active': !state.color }"
              title="默认颜色"
              @click="applyColor('color', null)"
            >
              A
            </button>
            <button
              v-for="entry in INLINE_COLORS"
              :key="entry.token"
              type="button"
              class="inline-format-swatch inline-format-swatch--text"
              :class="{ 'is-active': state.color === entry.token }"
              :style="{ color: `var(${entry.token})` }"
              :title="entry.label"
              @click="applyColor('color', entry.token)"
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
              :class="{ 'is-active': !state.background }"
              title="无背景色"
              @click="applyColor('background', null)"
            />
            <button
              v-for="entry in INLINE_COLORS"
              :key="entry.token"
              type="button"
              class="inline-format-swatch"
              :class="{ 'is-active': state.background === entry.token }"
              :style="{ backgroundColor: `var(${entry.token})` }"
              :title="entry.label"
              @click="applyColor('background', entry.token)"
            />
          </div>
        </div>

        <button
          type="button"
          class="inline-format-reset"
          title="清除文字色与背景色"
          @click="resetColors"
        >
          恢复默认
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.inline-format-toolbar {
  position: fixed;
  z-index: var(--z-popover);
  transform: translateY(-100%);
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-base);
  box-shadow: var(--shadow-floating);
}

.inline-format-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: 1;
  cursor: pointer;
}

.inline-format-button:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.inline-format-button.is-active,
.inline-format-button.is-open {
  background: var(--bg-active);
  color: var(--text-primary);
}

.underline-icon {
  text-decoration: underline;
}

.color-icon {
  font-weight: var(--font-semibold);
}

.inline-format-divider {
  width: 1px;
  height: 16px;
  margin: 0 3px;
  background: var(--border);
}

.inline-format-palette {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  min-width: 176px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-base);
  box-shadow: var(--shadow-floating);
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
