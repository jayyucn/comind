<script setup lang="ts">
/**
 * 选区格式按钮行：正文行内工具条与表格选区浮层**共用**的那一段。
 *
 * 两个入口的差异只允许出现在公共段**之后**（表格还要接合并 / 复制 / 删行列），
 * 公共段（对齐 + B/I/U/S/`<>`/A）无论选区是正文文字、格内文字还是格矩形，
 * 都必须同序、同形、同尺寸 —— 否则同一套东西在两个入口长得不一样，就是割裂感。
 * 因此顺序、字形、尺寸、hover/激活态、二级箭头的形状全部收口到这里，
 * 宿主只负责「这批选区是什么格式、写回到哪」。
 *
 * 唯一的例外是「添加链接」（`link`）：它插在公共段内部（行内代码左侧），
 * 但**默认不渲染**，只由正文浮层开启。表格宿主尚未实现链接写回，先长出按钮
 * 就是长出个死按钮 —— 等表格那一侧补上写入，再把门控放开。
 *
 * 根节点是**片段**（多根）：按钮直接参与宿主的 flex 排布，宿主的 gap / wrap / 对齐照旧生效，
 * 不需要再套一层容器。宿主追加的结构项经默认插槽接在 A 之后，
 * 它们的样式由本组件的 `:slotted()` 提供（插槽内容按 CSS 归属算在宿主作用域，
 * 普通 scoped 选择器够不到，`:slotted()` 正是为此存在）。
 */
import { ChevronDown, Code, Link } from 'lucide-vue-next'
import { computed } from 'vue'

import { BLOCK_ALIGN_OPTIONS, type BlockAlign } from '../../utils/block-align'
import type { InlineMarkKey } from '../../utils/inline-marks'

/**
 * 激活态需要的格式视图：只关心**真值**，不要求严格 `true`。
 *
 * `InlineMarkAttrs` 那边是 `bold?: true`（存储层的严谨写法），而宿主算出来的激活态
 * 多是布尔表达式的结果，塞给窄类型会整片报错；按钮只判真假，收窄没有收益。
 */
interface MarkView {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  /** 行内代码（`` `x` ``）：激活态决定按钮是否高亮，点一下就是加/取消 */
  code?: boolean
  color?: string | null
  background?: string | null
}

const props = defineProps<{
  /** 当前选区的合并格式（驱动 B/I/S/U 与色块的激活态） */
  format?: MarkView | null
  /** 当前对齐（未设置即默认左对齐） */
  align?: BlockAlign | null
  /** 当前展开的二级浮层，只用于按钮的 `is-open` 态；状态仍由宿主持有 */
  open?: 'align' | 'palette' | 'link' | null
  /**
   * 「添加链接」这一项（与 `wrapPageRef` 同一套三态口径）。
   *
   * - `null` / 不传：不渲染。表格宿主尚未接链接写回，长出按钮就是长出个点不动的按钮；
   * - `{ enabled: false, hint }`：置灰 + 透出具体原因；
   * - `{ enabled: true }`：可点。
   */
  link?: { enabled: boolean; hint?: string } | null
}>()

const emit = defineEmits<{
  (e: 'apply-mark', key: InlineMarkKey, token: string | null): void
  /** 宿主自己开/收对齐下拉（同一时刻只允许一个二级） */
  (e: 'toggle-align', anchor: HTMLElement): void
  /** 宿主自己开/收取色面板 */
  (e: 'toggle-palette', anchor: HTMLElement): void
  /** 宿主自己开链接编辑浮层（按钮作为锚点） */
  (e: 'add-link', anchor: HTMLElement): void
}>()

const currentAlign = computed<BlockAlign>(() => props.align ?? 'left')
const alignIcon = computed(
  () => BLOCK_ALIGN_OPTIONS.find(option => option.value === currentAlign.value)?.icon ?? BLOCK_ALIGN_OPTIONS[0]!.icon,
)

/** 合并色按钮：字形取文字色，按钮底色取背景色（与正文渲染同口径的 28% 淡染） */
const colorStyle = computed<Record<string, string>>(() => {
  const format = props.format
  const style: Record<string, string> = {}
  if (format?.color) style.color = `var(${format.color})`
  if (format?.background) style.background = `color-mix(in srgb, var(${format.background}) 28%, transparent)`
  return style
})

function anchorOf(e: MouseEvent): HTMLElement {
  return e.currentTarget as HTMLElement
}
</script>

<template>
  <button
    type="button"
    class="sel-btn sel-btn--caret"
    :class="{ 'is-on': currentAlign !== 'left', 'is-open': props.open === 'align' }"
    title="对齐方式"
    aria-label="对齐方式"
    @click="emit('toggle-align', anchorOf($event))"
  >
    <component
      :is="alignIcon"
      :size="14"
      :stroke-width="2"
    />
    <ChevronDown
      class="sel-caret"
      :size="10"
      :stroke-width="2.5"
    />
  </button>

  <span class="sel-sep" />

  <button
    type="button"
    class="sel-btn"
    :class="{ 'is-on': props.format?.bold }"
    title="加粗 (Ctrl+B)"
    aria-label="加粗"
    @click="emit('apply-mark', 'bold', null)"
  >
    <strong>B</strong>
  </button>
  <button
    type="button"
    class="sel-btn"
    :class="{ 'is-on': props.format?.italic }"
    title="斜体 (Ctrl+I)"
    aria-label="斜体"
    @click="emit('apply-mark', 'italic', null)"
  >
    <em>I</em>
  </button>
  <button
    type="button"
    class="sel-btn"
    :class="{ 'is-on': props.format?.underline }"
    title="下划线 (Ctrl+U)"
    aria-label="下划线"
    @click="emit('apply-mark', 'underline', null)"
  >
    <span class="sel-glyph--underline">U</span>
  </button>
  <button
    type="button"
    class="sel-btn"
    :class="{ 'is-on': props.format?.strike }"
    title="删除线 (Ctrl+Shift+X)"
    aria-label="删除线"
    @click="emit('apply-mark', 'strike', null)"
  >
    <s>S</s>
  </button>
  <!-- 添加链接：行内代码左侧（`<>` 左边）。三态门控见 props.link 的注释 -->
  <button
    v-if="props.link"
    type="button"
    class="sel-btn"
    :class="{ 'is-open': props.open === 'link' }"
    :disabled="!props.link.enabled"
    :title="props.link.enabled ? '添加链接 (Ctrl+K)' : (props.link.hint ?? '当前选区不能添加链接')"
    aria-label="添加链接"
    @click="emit('add-link', anchorOf($event))"
  >
    <Link
      :size="14"
      :stroke-width="2"
    />
  </button>
  <button
    type="button"
    class="sel-btn"
    :class="{ 'is-on': props.format?.code }"
    title="行内代码（再点一次取消）"
    aria-label="行内代码"
    @click="emit('apply-mark', 'code', null)"
  >
    <Code
      :size="14"
      :stroke-width="2"
    />
  </button>
  <button
    type="button"
    class="sel-btn"
    :class="{
      'is-on': !!props.format?.color || !!props.format?.background,
      'is-open': props.open === 'palette',
    }"
    :style="colorStyle"
    title="文字颜色与背景色"
    aria-label="文字颜色与背景色"
    @click="emit('toggle-palette', anchorOf($event))"
  >
    <span class="sel-glyph--color">A</span>
  </button>

  <!-- 宿主追加项（表格的结构项）：跟在 A 之后，与公共项同一个 flex 行 -->
  <slot />
</template>

<style scoped>
/* 公共项与宿主追加项同一套按钮视觉：一组选择器两张作用域标签 ——
   前者是本组件自己渲染的按钮，后者是宿主经插槽塞进来的（`-s` 由 Vue 运行时打在插槽节点上）。 */
.sel-btn,
:slotted(.sel-btn) {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1px;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: 1;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}

.sel-btn:not(:disabled):hover,
:slotted(.sel-btn:not(:disabled):hover) {
  background: var(--accent-subtle);
  color: var(--accent);
}

.sel-btn.is-on,
.sel-btn.is-open,
:slotted(.sel-btn.is-on),
:slotted(.sel-btn.is-open) {
  background: var(--accent-subtle);
  color: var(--accent);
}

.sel-btn:disabled,
:slotted(.sel-btn:disabled) {
  opacity: 0.4;
  cursor: default;
}

/* 带二级的项：主图标 + 右下角小箭头，宽度比纯图标项宽一点 */
.sel-btn--caret,
:slotted(.sel-btn--caret) {
  width: 34px;
  gap: 0;
}

/* 宿主的「需要强调」项（取消合并） */
.sel-btn--link,
:slotted(.sel-btn--link) {
  color: var(--link);
}

.sel-caret {
  flex: none;
  margin-top: 8px;
  margin-left: -2px;
  opacity: 0.7;
}

.sel-sep,
:slotted(.sel-sep) {
  width: 1px;
  height: 16px;
  margin: 0 3px;
  background: var(--border);
}

.sel-glyph--underline {
  text-decoration: underline;
}

.sel-glyph--color {
  font-weight: var(--font-semibold);
}
</style>
