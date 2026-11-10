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
const picker = ref<'color' | 'background' | null>(null)
const toolbarEl = ref<HTMLElement | null>(null)

/** 首帧尚未挂载时的兜底尺寸（真实尺寸在 nextTick 后补测） */
const FALLBACK_WIDTH = 236
const FALLBACK_HEIGHT = 34

const state = computed(() => {
  // 范围模式：选区由 BlockList 持有（编辑器已失活），格式来自 store 的合并结果
  if (props.range) {
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

function hide() {
  visible.value = false
  picker.value = null
}

function updatePosition() {
  const info = state.value
  if (!info) {
    hide()
    return
  }

  let centerX: number
  let anchorTop: number
  if (props.range) {
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
  () => [props.revision, props.editor, props.range, props.rangeRect, props.rangeFormat],
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
  if (props.range) {
    emit('apply-range', name, null)
    return
  }
  const editor = props.editor
  if (!editor) return
  editor.chain().focus().toggleMark(name).run()
  updatePosition()
}

function applyColor(kind: 'color' | 'background', token: string | null) {
  if (props.range) {
    emit('apply-range', kind, token)
    picker.value = null
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
  picker.value = null
  updatePosition()
}

function togglePicker(kind: 'color' | 'background') {
  picker.value = picker.value === kind ? null : kind
}

function hideOnScroll() {
  visible.value = false
  picker.value = null
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
        class="inline-format-button"
        :class="{ 'is-active': !!state.color, 'is-open': picker === 'color' }"
        title="文字颜色"
        @click="togglePicker('color')"
      >
        <span
          class="color-icon"
          :style="{ '--swatch': state.color ? `var(${state.color})` : 'var(--text-primary)' }"
        >A</span>
      </button>
      <button
        type="button"
        class="inline-format-button"
        :class="{ 'is-active': !!state.background, 'is-open': picker === 'background' }"
        title="背景色"
        @click="togglePicker('background')"
      >
        <span
          class="color-icon color-icon--bg"
          :style="{ '--swatch': state.background ? `var(${state.background})` : 'transparent' }"
        >A</span>
      </button>

      <div
        v-if="picker"
        class="inline-format-palette"
      >
        <div class="inline-format-palette-label">
          {{ picker === 'color' ? '文字颜色' : '背景色' }}
        </div>
        <div class="inline-format-palette-grid">
          <button
            type="button"
            class="inline-format-swatch inline-format-swatch--none"
            :class="{ 'is-active': picker === 'color' ? !state.color : !state.background }"
            title="无颜色"
            @click="applyColor(picker, null)"
          />
          <button
            v-for="entry in INLINE_COLORS"
            :key="entry.token"
            type="button"
            class="inline-format-swatch"
            :class="{ 'is-active': (picker === 'color' ? state.color : state.background) === entry.token }"
            :style="{ backgroundColor: `var(${entry.token})` }"
            :title="entry.label"
            @click="applyColor(picker, entry.token)"
          />
        </div>
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
  position: relative;
  font-weight: var(--font-semibold);
  border-bottom: 3px solid var(--swatch);
  padding-bottom: 1px;
}

.color-icon--bg {
  border-bottom-color: transparent;
  background: linear-gradient(transparent 58%, var(--swatch) 58%);
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

.inline-format-swatch--none {
  background:
    linear-gradient(to top right, transparent calc(50% - 1px), var(--border-strong) calc(50% - 1px), var(--border-strong) calc(50% + 1px), transparent calc(50% + 1px)),
    var(--bg-base);
}
</style>
