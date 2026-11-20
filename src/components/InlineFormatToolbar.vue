<script setup lang="ts">
import type { Editor } from '@tiptap/core'
import { Brackets } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { SelectionRect } from '../services/selection-geometry'
import type { TextRange } from '../services/text-range'
import type { BlockAlign } from '../utils/block-align'
import type { InlineMarkAttrs, InlineMarkKey } from '../utils/inline-marks'
import FloatingSubmenu from './common/FloatingSubmenu.vue'
import SelectionMarkRow from './common/SelectionMarkRow.vue'
import InlineAlignMenu from './InlineAlignMenu.vue'
import InlineColorPalette from './InlineColorPalette.vue'

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
  /**
   * 当前对齐（块级 `block.format.align`）。
   *
   * 对齐不是行内 mark：它按**块**存，作用对象是整块正文而不是选中的那几个字。
   * 因此三种模式下由宿主各自算出「这些块共同的对齐」传进来。
   */
  blockAlign?: BlockAlign | null
  /**
   * 「转为页面引用」这一个结构项的状态。
   *
   * - `null` / 不传：不渲染。用于能力**永不成立**的场景（跨 block 选区、表格），
   *   此时置灰反而会误导用户去改文本再试。
   * - `{ enabled: false, hint }`：单块内但选区不合规 → 置灰 + 提示判据。
   * - `{ enabled: true }`：可点。
   */
  wrapPageRef?: { enabled: boolean; hint?: string } | null
}>()

const emit = defineEmits<{
  (e: 'apply-range', key: InlineMarkKey, token: string | null): void
  (e: 'apply-align', value: BlockAlign): void
  /** 把当前单块选区包裹为 `[[页名]]`；页名解析与建页由宿主负责 */
  (e: 'wrap-page-ref'): void
}>()

const visible = ref(false)
const position = ref({ left: 0, top: 0 })
const toolbarEl = ref<HTMLElement | null>(null)

/** 二级浮层：同一时刻最多开一个（对齐下拉 / 取色面板），定位与 Esc 收口在 FloatingSubmenu */
type SubmenuKind = 'align' | 'palette'
const submenu = ref<SubmenuKind | null>(null)
const submenuAnchor = ref<HTMLElement | null>(null)

/** 首帧尚未挂载时的兜底尺寸（真实尺寸在 nextTick 后补测） */
const FALLBACK_WIDTH = 290
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

/** 当前对齐（未设置即默认左对齐）：与表格选区浮层同一份取值口径 */
const currentAlign = computed<BlockAlign>(() => props.blockAlign ?? 'left')

/**
 * 「转为页面引用」的悬浮文案。
 * 置灰时只写判据本身（含什么字符不行），不写「不支持」——后者等于没说，
 * 用户不知道是这段文字的问题还是功能不存在。
 */
const wrapPageRefTitle = computed(() => {
  const state = props.wrapPageRef
  if (!state) return ''
  return state.enabled ? '转为页面引用 [[页名]]' : (state.hint ?? '当前选区不可作为页面名')
})

function hide() {
  visible.value = false
  submenu.value = null
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

/**
 * 对齐是**块级样式**：点完正文在横向上整体重排，但选区的 from/to、`revision` 全都没变，
 * 上面那个 watch 不会触发 ⇒ 编辑态下工具条会停在旧位置（蓝带是浏览器原生选区，自己会跟）。
 * 必须等 DOM 重排落定再量一次坐标。
 */
watch(() => props.blockAlign, () => {
  void nextTick(() => {
    if (visible.value) updatePosition()
  })
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

/**
 * 公共按钮行的回调：色值走面板（选完保持展开，连续调整），字形走 mark 开关。
 */
function onApplyMark(key: InlineMarkKey, token: string | null) {
  if (key === 'color' || key === 'background') {
    applyColor(key, token)
    return
  }
  toggleMark(key)
}

/** 二级浮层互斥：同一个锚点引用 + 一个状态，开另一个就顶掉前一个 */
function toggleSubmenu(kind: SubmenuKind, anchor: HTMLElement) {
  if (submenu.value === kind) {
    submenu.value = null
    return
  }
  submenuAnchor.value = anchor
  submenu.value = kind
}

function pickAlign(value: BlockAlign) {
  submenu.value = null
  emit('apply-align', value)
}

function hideOnScroll() {
  visible.value = false
  submenu.value = null
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
      <!-- 公共按钮行：与表格选区浮层是同一个组件（对齐 + B/I/U/S/A 同序同形） -->
      <SelectionMarkRow
        :format="state"
        :align="currentAlign"
        :open="submenu"
        @apply-mark="onApplyMark"
        @toggle-align="(anchor: HTMLElement) => toggleSubmenu('align', anchor)"
        @toggle-palette="(anchor: HTMLElement) => toggleSubmenu('palette', anchor)"
      >
        <!-- 结构项（正文专属，经插槽追加；表格浮层不走本组件，故不会长出来）：
             格式 → 结构 之间加一道分隔，与公共段明确分组。 -->
        <template v-if="props.wrapPageRef">
          <span class="sel-sep" />
          <button
            type="button"
            class="sel-btn"
            :disabled="!props.wrapPageRef.enabled"
            :title="wrapPageRefTitle"
            aria-label="转为页面引用"
            @click="emit('wrap-page-ref')"
          >
            <Brackets
              :size="14"
              :stroke-width="2"
            />
          </button>
        </template>
      </SelectionMarkRow>
    </div>

    <!-- 对齐下拉：与表格选区浮层共用 InlineAlignMenu（上方优先、Esc 只关二级） -->
    <InlineAlignMenu
      :open="submenu === 'align'"
      :anchor="submenuAnchor"
      :current="currentAlign"
      @pick="pickAlign"
      @close="submenu = null"
    />

    <!-- 取色面板：与表格选区浮层同一套二级浮层规则（挂在 A 按钮上方，不压住选中的文字） -->
    <FloatingSubmenu
      :open="submenu === 'palette'"
      :anchor="submenuAnchor"
      @close="submenu = null"
    >
      <InlineColorPalette
        :color="state?.color"
        :background="state?.background"
        @apply="applyColor"
        @reset="resetColors"
      />
    </FloatingSubmenu>
  </Teleport>
</template>

<style scoped>
/* 面板本体：面皮 + 排布。按钮尺寸/配色/激活态在 SelectionMarkRow（与表格浮层同一份）。
   面皮与选区浮层（BasePopover 面板）同款三层渐变 —— 两个入口的差别只该是菜单项，不该是壳。 */
.inline-format-toolbar {
  position: fixed;
  z-index: var(--z-popover);
  transform: translateY(-100%);
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  background:
    var(--corner-glow) padding-box,
    var(--grad-surface) padding-box,
    var(--grad-border) border-box;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-floating);
}
</style>
