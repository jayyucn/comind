<script setup lang="ts">
// 通用 TOC 浮层（替代原 BookNotesOutline）：
// - 普通页：扫描标题块（content `#{1,6} ` 前缀或 format.type==='heading'），按 level 嵌套成文档大纲；
// - 书页：复用 part/chapter/cfi 属性投影（book-notes-group）；
// - 点击行 dispatch navigate-to-block（Page/index.vue 监听滚动+高亮）；
//   书源叶子节点带 cfi 时显示「原文」跳回阅读器。
// 浮层 Teleport 到 body，固定定位在左侧留白带，窄屏自动隐藏，可收起。
import { TextAlignJustify, TextAlignStart } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { buildTree } from '../../composables/useBlockTree'
import { parseHeading } from '../../composables/useContentRenderer'
import { openReaderWindow } from '../../composables/useReaderWindow'
import { groupBookNotesByChapter, type BookNoteMeta } from '../../services/book-notes-group'
import { useBlockStore } from '../../stores/blocks'
import { usePageStore } from '../../stores/pages'
import { usePropertyStore } from '../../stores/property'
import type { Block, TreeNode } from '../../types/block'
import { isTauriEnvironment } from '../../wasm/tauri-platform'
import TocItem, { type TocNode } from './TocItem.vue'

const props = defineProps<{
  /** 页面 id（兼容 UUID 或 date title） */
  pageId: string
}>()

const pageStore = usePageStore()
const blockStore = useBlockStore()
const propertyStore = usePropertyStore()

const page = computed(() => pageStore.getPage(props.pageId) ?? null)
const isBook = computed(() => page.value?.type === 'book')
const rootBlockId = computed(() => page.value?.blockId ?? null)

const tree = computed<TreeNode[]>(() =>
  buildTree(blockStore.blocks, props.pageId, rootBlockId.value),
)

function propValue(blockId: string, key: string): string {
  const p = propertyStore.getBlockProperties(blockId).find(x => x.key === key && !x.isDeleted)
  return p ? String(p.value) : ''
}

/** 文档序展开（DFS 前序）：普通页大纲只需块序，与块树父子关系无关 */
function flatten(nodes: TreeNode[]): Block[] {
  const out: Block[] = []
  for (const n of nodes) {
    out.push(n.block)
    out.push(...flatten(n.children))
  }
  return out
}

/** 块 content 可能为 HTML，取纯文本用于大纲显示 */
function toPlainText(s: string): string {
  if (!s) return ''
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim()
}

/**
 * 提取块中的标题信息。comind 的 heading 有两种来源，须同时兼容：
 * 1. 编辑器手打：type 仍为 'bullet'，content 以 `#{1,6} ` 前缀标记，级别由前缀长度决定
 *    （BulletRender.vue 即靠 parseHeading(content) 渲染，TOC 必须与之保持一致）；
 * 2. 模板插入：format.type==='heading' + format.level，content 无 `#` 前缀。
 * 任一命中即视为标题，优先用 parseHeading（覆盖绝大多数真实文档）。
 */
function extractHeading(b: Block): { level: number; title: string } | null {
  const parsed = parseHeading(b.content)
  if (parsed) return { level: parsed.level, title: parsed.title }
  if (b.format?.type === 'heading') {
    return { level: Number(b.format?.level ?? 2), title: b.content }
  }
  return null
}

// 普通页：纯 heading 扫描，按 level 嵌套（level 由内容前缀或 format 决定，支持 h1–h6）
const headingNodes = computed<TocNode[]>(() => {
  const roots: TocNode[] = []
  const stack: TocNode[] = []
  for (const b of flatten(tree.value)) {
    const h = extractHeading(b)
    if (!h) continue
    const node: TocNode = {
      id: b.id,
      title: toPlainText(h.title),
      level: h.level,
      blockId: b.id,
      children: [],
    }
    while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop()
    if (stack.length) stack[stack.length - 1].children.push(node)
    else roots.push(node)
    stack.push(node)
  }
  return roots
})

// 书页：复用 part/chapter 属性投影（结构化数据由阅读器固化，侧不解析 TOC）
const bookNodes = computed<TocNode[]>(() => {
  const notes: BookNoteMeta[] = tree.value.map(n => ({
    blockId: n.id,
    part: propValue(n.id, 'part'),
    chapter: propValue(n.id, 'chapter'),
    cfi: propValue(n.id, 'cfi') || null,
  }))
  const groups = groupBookNotesByChapter(notes)
  return groups.map(g => ({
    id: `ch:${g.title}`,
    title: g.title,
    level: 1,
    blockId: g.first.blockId,
    cfi: g.first.cfi,
    children: g.sections.map(s => ({
      id: `sec:${s.title}`,
      title: s.title,
      level: 2,
      blockId: s.first.blockId,
      cfi: s.first.cfi,
      children: [],
    })),
  }))
})

const nodes = computed<TocNode[]>(() => (isBook.value ? bookNodes.value : headingNodes.value))

/** 书页需属性到位才能分组；属性拉取仅书页触发，普通页不额外加载 */
const noteIds = computed(() => tree.value.map(n => n.id))
watch(
  noteIds,
  ids => {
    if (isBook.value && ids.length > 0) void propertyStore.loadMultiBlockProperties(ids)
  },
  { immediate: true },
)

const collapsed = ref(false)
const canJump = computed(() => isTauriEnvironment())

// —— TOC 布局常量（调试入口：只改这里）——
const TOC_GAP_LEFT = 16   // 左间距：侧栏右缘 → TOC 左缘
const TOC_GAP_RIGHT = 24  // 右间距：TOC 右缘 → 正文左缘
const TOC_MIN_WIDTH = 200 // 自适应宽度低于该阈值 → 隐藏 TOC

// 布局用实测而不用 50vw 公式：正文列随侧栏/右侧栏开合重新居中，
// 公式极易漏算（曾致折叠态 TOC 压进正文）。每次直接量 DOM：
//   left  = 侧栏当前宽度 + TOC_GAP_LEFT
//   width = 正文左缘 - TOC_GAP_RIGHT - left
const tocLeft = ref('0px')
const tocWidth = ref('0px')
const tocHidden = ref(true)

// 展开时让宽度做过渡（40 → 实测宽度）更自然；而实测驱动（侧栏折叠、窗口缩放）
// 必须关掉过渡逐帧跟随，否则过渡与逐帧更新叠加会拖影。
const noAnim = ref(false)
let noAnimTimer = 0

let layoutRO: ResizeObserver | null = null

/** @param animate 是否让本次宽度变化走过渡（仅展开为 true） */
function updateTocLayout(animate = false): void {
  const contentEl = document.querySelector<HTMLElement>('.page-container .main-content')
  if (!contentEl) {
    tocHidden.value = true
    return
  }
  const sidebarEl = document.querySelector<HTMLElement>('.sidebar')
  const left = (sidebarEl?.getBoundingClientRect().width ?? 0) + TOC_GAP_LEFT
  const width = contentEl.getBoundingClientRect().left - TOC_GAP_RIGHT - left
  if (width < TOC_MIN_WIDTH) {
    tocHidden.value = true
    return
  }
  if (!animate) {
    noAnim.value = true
    window.clearTimeout(noAnimTimer)
    noAnimTimer = window.setTimeout(() => { noAnim.value = false }, 0)
  }
  tocHidden.value = false
  tocLeft.value = `${Math.round(left)}px`
  tocWidth.value = collapsed.value ? '40px' : `${Math.round(width)}px`
}

function startLayoutObserver(): void {
  // jsdom 等测试环境无 ResizeObserver，直接跳过（布局保持隐藏，不影响断言）
  if (typeof ResizeObserver === 'undefined') return
  // content-body：侧栏/右侧栏开合、窗口缩放都会改变其宽度 → 触发重测；
  // sidebar：折叠 width 动画期间逐帧重测，TOC 与侧栏同步滑动
  // 注意包一层：RO 回调会传入 entries，直接传函数会被当作 animate 实参
  layoutRO = new ResizeObserver(() => updateTocLayout())
  for (const sel of ['.content-body', '.sidebar']) {
    const el = document.querySelector(sel)
    if (el) layoutRO.observe(el)
  }
  updateTocLayout()
}

// 展开/收起都做宽度过渡（镜像对称）：
// 收起时宽度实测值→40 与内容淡出同步进行，内容是「被逐步裁切着淡出」，
// 而非上次那种「宽度瞬时到 40 后内容仍亮着」导致的 chevron 碎片闪现。
watch(collapsed, () => updateTocLayout(true))

/** resize 事件对象不能直接作实参传给 updateTocLayout（会被当 animate 真值） */
function onResize(): void {
  updateTocLayout()
}

function locate(blockId: string): void {
  window.dispatchEvent(new CustomEvent('navigate-to-block', { detail: { blockId } }))
}
function jump(cfi: string): void {
  void openReaderWindow(props.pageId, { jumpCfi: cfi })
}
function total(nodes: TocNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + total(n.children), 0)
}
const count = computed(() => total(nodes.value))

// —— 滚动联动高亮（scroll-spy）——
const activeId = ref('')

/** TocNode 文档序展开（DFS 前序），用于按页面顺序判定当前标题 */
function flattenToc(list: TocNode[]): TocNode[] {
  const out: TocNode[] = []
  for (const n of list) {
    out.push(n)
    out.push(...flattenToc(n.children))
  }
  return out
}

/**
 * 解析真正可滚动的页面容器。
 * 注意：App.vue 的 .page-scroll-wrapper 是 scoped 样式且 overflow:hidden，
 * 实际滚动发生在它内部的某个祖先元素上；而 scroll 事件不冒泡，
 * 所以这里从首个 block 向上找「第一个真的可滚动」的祖先（scrollHeight>clientHeight），
 * 找不到时回退到 .page-scroll-wrapper / window。
 */
function resolveScroller(): HTMLElement | Window {
  const firstBlock = document.querySelector<HTMLElement>('[data-block-id]')
  if (firstBlock) {
    let el: HTMLElement | null = firstBlock.parentElement
    while (el && el !== document.body) {
      const y = getComputedStyle(el).overflowY
      if ((y === 'auto' || y === 'scroll' || y === 'overlay') && el.scrollHeight > el.clientHeight + 1) {
        return el
      }
      el = el.parentElement
    }
  }
  return document.querySelector<HTMLElement>('.page-scroll-wrapper') ?? window
}

let scroller: HTMLElement | Window = window
let rafId = 0
let cleanupScroller: (() => void) | null = null

/** 给解析到的真实滚动容器单独挂监听（双保险，window 捕获已能覆盖） */
function attachScroller(): void {
  cleanupScroller?.()
  cleanupScroller = null
  if (scroller !== window) {
    const el = scroller as HTMLElement
    el.addEventListener('scroll', onScroll, { passive: true })
    cleanupScroller = () => el.removeEventListener('scroll', onScroll)
  }
}

/**
 * 计算当前应高亮的标题：最后一个越过「滚动容器顶部 + 偏移」触发线的标题。
 * 页面尚未滚到首个标题时保持空（不高亮），避免误标。
 */
function computeActive(): void {
  const ids = flattenToc(nodes.value)
    .map(n => n.blockId)
    .filter(Boolean)
  if (ids.length === 0) {
    activeId.value = ''
    return
  }
  const scrollerEl = scroller === window ? document.documentElement : (scroller as HTMLElement)
  const threshold = scrollerEl.getBoundingClientRect().top + 100
  let current = ''
  for (const id of ids) {
    const el = document.querySelector<HTMLElement>(`[data-block-id="${id}"]`)
    if (!el) continue
    if (el.getBoundingClientRect().top <= threshold) current = id
    else break
  }
  activeId.value = current
}

function onScroll(): void {
  if (rafId) return
  rafId = requestAnimationFrame(() => {
    rafId = 0
    computeActive()
  })
}

onMounted(() => {
  scroller = resolveScroller()
  attachScroller()
  // 捕获阶段监听 window：scroll 不冒泡，但会在捕获阶段被 window 捕获，
  // 因此无论真正滚动的是哪个内部元素，都能触发高亮重算。
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', onScroll, { passive: true })
  window.addEventListener('resize', onResize, { passive: true })
  startLayoutObserver()
  // 首次渲染后若干帧再解析一次（block DOM 可能尚未挂载）并重算
  nextTick(() => {
    requestAnimationFrame(() => {
      scroller = resolveScroller()
      attachScroller()
      computeActive()
      updateTocLayout()
    })
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', onScroll)
  window.removeEventListener('resize', onResize)
  window.clearTimeout(noAnimTimer)
  layoutRO?.disconnect()
  layoutRO = null
  cleanupScroller?.()
  if (rafId) cancelAnimationFrame(rafId)
})

// 标题树变化（加载/编辑/切页）后重算；块 DOM 需在 nextTick 后才存在
watch(nodes, () => nextTick(computeActive))
watch(
  () => props.pageId,
  () => nextTick(computeActive),
)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="nodes.length > 0"
      class="toc-panel"
      :class="{ 'is-hidden': tocHidden, 'is-tracking': noAnim }"
      :style="{ left: tocLeft, width: tocWidth }"
    >
      <div class="toc-head">
        <button
          v-if="!collapsed"
          class="toc-toggle"
          title="收起目录"
          @click="collapsed = true"
        >
          <TextAlignStart :size="18" />
        </button>
        <button
          v-else
          class="toc-reopen"
          title="展开目录"
          @click="collapsed = false"
        >
          <TextAlignJustify :size="18" />
        </button>
        <Transition name="toc-fade">
          <div
            v-if="!collapsed"
            class="toc-head-meta"
          >
            <span class="toc-title">目录</span>
            <span class="toc-count">{{ count }}</span>
          </div>
        </Transition>
      </div>
      <Transition name="toc-list">
        <ul
          v-if="!collapsed"
          class="toc-list"
        >
          <TocItem
            v-for="n in nodes"
            :key="n.id"
            :node="n"
            :depth="0"
            :can-jump="canJump"
            :active-id="activeId"
            @locate="locate"
            @jump="jump"
          />
        </ul>
      </Transition>
    </div>
  </Teleport>
</template>

<style lang="scss" scoped>
.toc-panel {
  position: fixed;
  top: calc(var(--nav-height) + 16px);
  // left / width 由 updateTocLayout 实测驱动（inline 绑定，见脚本顶部常量）：
  // 左右间距恒定，宽度自适应填满中间，低于阈值加 is-hidden 隐藏。
  padding-right: 16px;
  max-height: calc(100vh - var(--nav-height) - 32px);
  display: flex;
  flex-direction: column;
  background: transparent;
  z-index: var(--z-sidebar);
  overflow: hidden;

  // 展开/自身折叠时宽度做过渡（40 ↔ 实测宽度）；
  // 但实测驱动（侧栏折叠、窗口缩放）由 is-tracking 关掉，
  // 让 TOC 逐帧跟随侧栏动画而不过渡拖影。
  transition: width 220ms cubic-bezier(0.4, 0, 0.2, 1);

  &.is-tracking {
    transition: none;
  }

  &.is-hidden {
    visibility: hidden;
  }
}

.toc-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  flex-shrink: 0;
}

.toc-head-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.toc-title {
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--text-secondary);
  white-space: nowrap;
}

.toc-count {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  white-space: nowrap;
  flex-shrink: 0;
}

.toc-toggle,
.toc-reopen {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: background 120ms ease, color 120ms ease, transform 120ms ease;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-secondary);
  }

  &:active {
    transform: scale(0.92);
  }
}

.toc-list {
  list-style: none;
  margin: 0;
  padding: 6px;
  overflow-y: auto;
  flex: 1;
  scrollbar-width: thin;
  scrollbar-color: var(--border-light) transparent;

  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--border-light);
    border-radius: 999px;
    border: 2px solid var(--bg-base);
  }

  &::-webkit-scrollbar-thumb:hover {
    background: var(--text-disabled);
  }
}

// 折叠态：收成只容纳图标的细条，标题与列表让位（head padding 保持不变，按钮位置不动）

// 头部元信息 / 列表：入场淡入、离场淡出（与宽度过渡并行，构成镜像动画）。
// 不能改回 display:none 离场——面板无背景，宽度过渡本身不可见，
// 收起的动画正是「内容被裁切着淡出」；内容瞬间消失会让收起变回硬切。
.toc-fade-enter-active,
.toc-fade-leave-active {
  transition: opacity 150ms ease;
}

.toc-fade-enter-from,
.toc-fade-leave-to {
  opacity: 0;
}

.toc-list-enter-active,
.toc-list-leave-active {
  transition: opacity 160ms ease;
}

.toc-list-enter-from,
.toc-list-leave-to {
  opacity: 0;
}
</style>
