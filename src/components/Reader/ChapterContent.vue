<script setup lang="ts">
// 单章滚动容器（票 03/04/05/06 / ADR-0040 D1/D6/D7/D10）：EPUB section →
// createDocument 取章节 XHTML → 书内图片资源替换为 blob: URL → 严格 sanitize →
// 注入主文档（非 iframe）。组件由 ReaderView 以 :key=section.id 重建（每章一个
// 实例），objectURL 在卸载时统一回收。
// 票 04：滚动位置 → 可视区首个文本 CFI（debounce 1s）写 upsert_book_progress；
// 恢复 = 解析 restoreCfi → scrollIntoView。排版参数由 ReaderView 落地 CSS 变量
// （--reader-font-size 等），本组件样式消费——排版变化不影响 CFI 锚定（文字锚定）。
// 票 05：selectionchange → 非空选区浮现操作条 → Range→CFI→upsert_book_highlight；
// 重绘 = 渲染完成后 get_book_highlights → 逐条解析 → CSS Custom Highlight 绘制层
// （等价 <mark> 包裹但不改 DOM——正文 DOM 稳定是 CFI 锚定/进度保存的前提）；
// 点已有高亮 → 小浮层删除（仅删高亮行，不删关联 Block，ADR-0040 D7）。
// 票 06：操作条/高亮浮层「写笔记」→ NoteInputPopover（v1 纯文本）→
// createOrUpdateNoteBlock（书 Page 下 append Block + 属性四件套 + 回填
// block_id + emitTo 主窗口刷新）；jumpCfi 跳转定位（跳回原文）+ 闪烁提示。
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { EPUB, EPUBSection } from 'foliate-js/epub.js'
import { sanitizeChapterContent } from '../../services/epub-sanitize'
import { cfiFromRange, cfiToRange, cfiToSpineIndex } from '../../services/epub-cfi'
import { createOrUpdateNoteBlock, loadNoteText } from '../../services/book-note'
import type { BookHighlightRust } from '../../wasm/types'
import { initCoreClient } from '../../wasm/client'
import SelectionToolbar from './SelectionToolbar.vue'
import HighlightPopover from './HighlightPopover.vue'
import NoteInputPopover from './NoteInputPopover.vue'

const props = defineProps<{
  book: EPUB
  section: EPUBSection
  /** 书 Page id（进度/高亮落库键） */
  bookId: string
  /** 本章在 spine 中的序号（CFI 的 section 前缀来源） */
  spineIndex: number
  /** 本章目录名（高亮记录的章节快照） */
  chapterTitle?: string
  /** 书名（笔记 Block 的 book 属性快照） */
  bookTitle?: string
  /** 待恢复的进度 CFI（仅恢复章且首跳时传入，定位失败静默跳过） */
  restoreCfi?: string | null
  /** 跳回原文的目标 CFI（票 06：非空时渲染完成后定位+闪烁，一次性） */
  jumpCfi?: string | null
  /** 高亮数据版本（票 07：面板删除后父级递增，触发本章高亮重载重绘） */
  highlightVersion?: number
}>()

const emit = defineEmits<{
  'jump-done': []
  /** 滚到底继续向下滚 → 请求翻到下一章（ReaderView 接 next） */
  'next-page': []
}>()

const containerRef = ref<HTMLElement | null>(null)

/** 本章经 URL.createObjectURL 创建的资源链接（卸载时 revoke，防泄漏） */
let objectUrls: string[] = []
/** 渲染代数：组件重建竞态兜底（异步渲染期间被卸载则丢弃结果） */
let renderGeneration = 0

/** 进度保存 debounce 计时器 */
let saveTimer: ReturnType<typeof setTimeout> | null = null
/** 进度保存 debounce 间隔（票 04：~1s） */
const SAVE_DEBOUNCE_MS = 1000

/** CSS Custom Highlight 注册名（绘制层） */
const HIGHLIGHT_KEY = 'reader-highlight'
/** 跳回原文闪烁提示的绘制层注册名（票 06） */
const JUMP_FLASH_KEY = 'reader-jump-flash'
/** 闪烁提示持续时间 */
const JUMP_FLASH_MS = 1600
/** v1 单色高亮（默认黄；数据模型 color 字段已留，多色不在 v1） */
const HIGHLIGHT_COLOR = 'yellow'

/** 本章高亮记录（渲染完成后从库里读取） */
const chapterHighlights = ref<BookHighlightRust[]>([])
/** 高亮 id → 解析后的正文 Range（绘制与命中检测共用） */
const highlightRanges = new Map<string, Range>()

/** 选区操作条（票 05） */
const toolbarVisible = ref(false)
const toolbarX = ref(0)
const toolbarY = ref(0)

/** 高亮删除浮层（票 05）：当前命中的高亮 id，null = 隐藏 */
const popoverHighlightId = ref<string | null>(null)
const popoverX = ref(0)
const popoverY = ref(0)

/** 写笔记输入浮层（票 06）：待写笔记的高亮上下文，null = 隐藏 */
interface NoteDraft {
  x: number
  y: number
  highlight: BookHighlightRust
  /** 已有笔记的预填文本（更新路径） */
  initialText?: string
}
const noteDraft = ref<NoteDraft | null>(null)

/** 相对 URI 是否带协议头（http:/https:/data: 等，即书外资源；与 foliate isExternal 一致） */
function isExternalUri(uri: string): boolean {
  return /^(?!blob)\w+:/i.test(uri)
}

/** node 是否在 root 子树内（含 root 自身） */
function nodeInside(node: Node | null, root: Node): boolean {
  for (let cur: Node | null = node; cur; cur = cur.parentNode) {
    if (cur === root) return true
  }
  return false
}

/** 章节内相对引用 → zip 内路径（与 foliate resolveURL 的 zip 分支一致） */
function resolveZipPath(uri: string, relativeTo: string): string {
  const root = 'https://invalid.invalid/'
  const obj = new URL(uri.replace(/%2c/, ','), root + relativeTo)
  obj.search = ''
  return decodeURI(obj.href.replace(root, ''))
}

/**
 * 章节图片：书内资源经 book.loadBlob 取 blob → blob: URL 替换 src；
 * 外链（http/data 等）与缺失资源直接剥掉 src（sanitize 是第二道防线）。
 */
async function resolveImages(doc: Document): Promise<void> {
  const images = Array.from(doc.querySelectorAll('img[src]'))
  for (const img of images) {
    const src = img.getAttribute('src') ?? ''
    if (isExternalUri(src)) {
      img.removeAttribute('src')
      continue
    }
    let blob: Blob | null = null
    try {
      blob = await props.book.loadBlob(resolveZipPath(src, props.section.id))
    } catch {
      blob = null
    }
    if (!blob || blob.size === 0) {
      img.removeAttribute('src')
      continue
    }
    const url = URL.createObjectURL(blob)
    objectUrls.push(url)
    img.setAttribute('src', url)
  }
}

function releaseObjectUrls(): void {
  for (const url of objectUrls) URL.revokeObjectURL(url)
  objectUrls = []
}

/** 取章节正文根（XML 解析的 XHTML Document 未必有 .body 属性，按 localName 兜底） */
function getBody(doc: Document): Element {
  return doc.getElementsByTagName('body')[0] ?? doc.documentElement
}

function replaceContent(fragment: DocumentFragment): void {
  const el = containerRef.value
  if (!el) return
  el.replaceChildren(fragment)
  el.scrollTop = 0
}

function showPlainMessage(message: string): void {
  const el = containerRef.value
  if (el) el.textContent = message
}

/** 恢复进度：解析 CFI → 定位 DOM range → scrollIntoView（失败静默留在顶部） */
function restoreScroll(): void {
  const el = containerRef.value
  const cfi = props.restoreCfi
  if (!el || !cfi) return
  const range = cfiToRange(el, cfi)
  if (!range) return
  // startContainer 可能是 text 节点（无 scrollIntoView），取其所在元素
  const node = range.startContainer
  const target: Element | null =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  target?.scrollIntoView({ block: 'start' })
}

/** 可视区首个非空文本的 collapsed Range（滚动进度的锚点） */
function firstVisibleTextRange(container: HTMLElement): Range | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const viewportTop = container.getBoundingClientRect().top
  let node: Node | null
  while ((node = walker.nextNode())) {
    const text = node.nodeValue ?? ''
    if (!text.trim()) continue
    // 探测矩形（首字符即可）：底部到达视口顶 = 该文本可见或在视口下方。
    // Range.getBoundingClientRect 在无布局环境（jsdom）缺失 → 视为可见
    const probe = document.createRange()
    probe.setStart(node, 0)
    probe.setEnd(node, Math.min(text.length, 1))
    const hasLayout = typeof probe.getBoundingClientRect === 'function'
    if (!hasLayout || probe.getBoundingClientRect().bottom >= viewportTop) {
      const range = document.createRange()
      range.setStart(node, 0)
      range.setEnd(node, 0)
      return range
    }
  }
  return null
}

/** 当前滚动位置写库（失败静默：进度保存不该打断阅读） */
async function saveProgress(): Promise<void> {
  const el = containerRef.value
  if (!el) return
  const range = firstVisibleTextRange(el)
  if (!range) return
  try {
    const cfi = cfiFromRange(el, range, props.spineIndex)
    const client = await initCoreClient()
    await client.upsertBookProgress(props.bookId, cfi)
  } catch (e) {
    console.warn('[reader] 阅读进度保存失败:', e)
  }
}

function onScroll(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void saveProgress()
  }, SAVE_DEBOUNCE_MS)
}

/** 翻页冷却：切章重建异步完成前丢弃同一滚动手势的后续 wheel 事件，防连跳 */
let flipCooldown = false

/** 滚到底继续向下滚 → 翻到下一章（符合直觉的连读；翻页后新章定位在顶部） */
function onWheel(e: WheelEvent): void {
  const el = containerRef.value
  if (!el || e.deltaY <= 0 || flipCooldown) return
  // 已在底部（内容不足一屏时恒为真，此时向下滚同样翻页）
  if (el.scrollTop + el.clientHeight < el.scrollHeight - 2) return
  flipCooldown = true
  setTimeout(() => { flipCooldown = false }, 400)
  emit('next-page')
}

async function render(): Promise<void> {
  const myGen = ++renderGeneration
  releaseObjectUrls()

  let doc: Document
  try {
    doc = await props.section.createDocument()
  } catch (e) {
    console.error('[reader] 章节解析失败:', e)
    if (myGen === renderGeneration) showPlainMessage('本章内容无法解析')
    return
  }

  await resolveImages(doc)
  if (myGen !== renderGeneration) return

  // 注意：以 chapter 的 body 为根做 sanitize（head 里的 title/style 等不进正文）
  const fragment = sanitizeChapterContent(getBody(doc))
  if (myGen !== renderGeneration) return
  replaceContent(fragment)
  // 票 04：渲染完成后恢复进度定位（CFI 基于同构 DOM，与排版参数无关）
  // 票 05：渲染完成后加载本章高亮并重绘
  if (myGen === renderGeneration) {
    restoreScroll()
    void loadHighlights(myGen)
    // 票 06：跳回原文（切章重建组件时 jumpCfi prop 已就位，渲染完成后定位）
    if (props.jumpCfi) performJump()
  }
}

/** 跳转定位（票 06）：解析 CFI → scrollIntoView + 闪烁提示，一次性后通知父级清空 */
function performJump(): void {
  const el = containerRef.value
  const cfi = props.jumpCfi
  emit('jump-done')
  if (!el || !cfi) return
  const range = cfiToRange(el, cfi)
  if (!range) return
  // startContainer 可能是 text 节点（无 scrollIntoView），取其所在元素
  const node = range.startContainer
  const target: Element | null =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  target?.scrollIntoView({ block: 'center' })
  flashRange(range)
}

/** 跳转目标闪烁提示：临时注册到 CSS Custom Highlight 绘制层，超时自动移除 */
function flashRange(range: Range): void {
  const registry = (CSS as { highlights?: HighlightRegistry }).highlights
  if (!registry || typeof Highlight === 'undefined') return
  registry.set(JUMP_FLASH_KEY, new Highlight(range))
  setTimeout(() => registry.delete(JUMP_FLASH_KEY), JUMP_FLASH_MS)
}

// jumpCfi 同章后续变化（如已在该章再点「↗ 原文」）：直接定位
watch(
  () => props.jumpCfi,
  cfi => {
    if (cfi) performJump()
  },
)

// 票 07：高亮数据版本变化（面板删除）→ 重载本章高亮并重绘（正文与面板同步）
watch(
  () => props.highlightVersion,
  () => {
    void loadHighlights(renderGeneration)
  },
)

// ---- 票 05：高亮（CFI 锚定） ----

/** 渲染完成后读取本章高亮（读取失败静默：高亮是增强而非关键路径） */
async function loadHighlights(myGen: number): Promise<void> {
  try {
    const client = await initCoreClient()
    const all = await client.getBookHighlights(props.bookId)
    if (myGen !== renderGeneration) return
    chapterHighlights.value = all.filter(h => cfiToSpineIndex(h.cfi) === props.spineIndex)
  } catch (e) {
    console.warn('[reader] 高亮读取失败:', e)
    return
  }
  if (myGen !== renderGeneration) return
  redrawHighlights()
}

/** 把解析后的 Range 注册到 CSS Custom Highlight（绘制层） */
function applyHighlightRegistry(): void {
  // CSS Custom Highlight API（Chromium 105+）；无布局环境（jsdom 等）静默降级
  const registry = (CSS as { highlights?: HighlightRegistry }).highlights
  if (!registry || typeof Highlight === 'undefined') return
  if (highlightRanges.size === 0) {
    registry.delete(HIGHLIGHT_KEY)
    return
  }
  registry.set(HIGHLIGHT_KEY, new Highlight(...highlightRanges.values()))
}

/** 逐条解析本章高亮 CFI → Range → 绘制；解析失败静默跳过该条（不阻塞渲染） */
function redrawHighlights(): void {
  const el = containerRef.value
  highlightRanges.clear()
  if (el) {
    for (const h of chapterHighlights.value) {
      const range = cfiToRange(el, h.cfi)
      if (range) highlightRanges.set(h.id, range)
    }
  }
  applyHighlightRegistry()
}

/** selectionchange：非空选区整体在正文内 → 操作条浮现于选区上方 */
function onSelectionChange(): void {
  const el = containerRef.value
  const sel = document.getSelection()
  if (!el || !sel || sel.rangeCount === 0 || sel.isCollapsed) {
    toolbarVisible.value = false
    return
  }
  const range = sel.getRangeAt(0)
  if (!nodeInside(range.startContainer, el) || !nodeInside(range.endContainer, el)) {
    toolbarVisible.value = false
    return
  }
  // 选区矩形上方居中（Range.getBoundingClientRect 无布局环境缺失 → 退化为左上角）
  let x = 16
  let y = 16
  if (typeof range.getBoundingClientRect === 'function') {
    const rect = range.getBoundingClientRect()
    x = rect.left + rect.width / 2
    y = rect.top
  }
  toolbarX.value = Math.max(x, 8)
  toolbarY.value = Math.max(y, 8)
  toolbarVisible.value = true
}

/** 操作条「高亮」：选区 Range → CFI → upsert_book_highlight（含文本快照/章节名） */
async function createHighlight(): Promise<void> {
  const sel = document.getSelection()
  toolbarVisible.value = false
  const saved = await saveHighlight()
  // 划线完成：清选区
  if (saved) sel?.removeAllRanges()
}

/** 选区 → 高亮行落库并绘制（「高亮」与「写笔记」共用；返回落库后的高亮行） */
async function saveHighlight(): Promise<BookHighlightRust | null> {
  const el = containerRef.value
  const sel = document.getSelection()
  if (!el || !sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  const text = range.toString()
  if (!text.trim()) return null
  try {
    const cfi = cfiFromRange(el, range, props.spineIndex)
    const now = Date.now()
    const client = await initCoreClient()
    const saved = await client.upsertBookHighlight({
      id: crypto.randomUUID(),
      book_page_id: props.bookId,
      cfi,
      text,
      chapter: props.chapterTitle ?? '',
      color: HIGHLIGHT_COLOR,
      block_id: null,
      created_at: now,
      updated_at: now,
    })
    chapterHighlights.value.push(saved)
    redrawHighlights()
    return saved
  } catch (e) {
    console.warn('[reader] 高亮保存失败:', e)
    return null
  }
}

// ---- 票 06：写笔记（高亮 → Block） ----

/** 操作条「写笔记」：先落高亮行（D7：笔记锚定高亮）→ 打开输入浮层 */
async function startNoteFromSelection(): Promise<void> {
  toolbarVisible.value = false
  const saved = await saveHighlight()
  document.getSelection()?.removeAllRanges()
  if (!saved) return
  noteDraft.value = { x: toolbarX.value, y: toolbarY.value, highlight: saved }
}

/** 高亮浮层「写笔记」：已有 block_id 则预填旧文（更新路径），否则新建 */
async function startNoteFromHighlight(): Promise<void> {
  const id = popoverHighlightId.value
  popoverHighlightId.value = null
  const h = chapterHighlights.value.find(x => x.id === id)
  if (!h) return
  let initialText: string | undefined
  if (h.block_id) {
    try {
      initialText = await loadNoteText(h.block_id)
    } catch {
      // 库中无此 block（异常数据）：按新建处理
    }
  }
  noteDraft.value = { x: popoverX.value, y: popoverY.value, highlight: h, initialText }
}

/** 输入浮层提交：走 book-note 写路径（新建/更新 Block + 属性 + 回填 + 跨窗口刷新） */
async function submitNote(text: string): Promise<void> {
  const draft = noteDraft.value
  noteDraft.value = null
  if (!draft) return
  try {
    const { highlight } = await createOrUpdateNoteBlock({
      bookPageId: props.bookId,
      bookTitle: props.bookTitle ?? '',
      chapter: draft.highlight.chapter,
      cfi: draft.highlight.cfi,
      quote: draft.highlight.text,
      text,
      highlight: draft.highlight,
    })
    // 本地高亮行同步 block_id（后续「再写」走更新路径）
    const idx = chapterHighlights.value.findIndex(h => h.id === highlight.id)
    if (idx >= 0) chapterHighlights.value[idx] = highlight
  } catch (e) {
    console.warn('[reader] 笔记保存失败:', e)
  }
}

/** 操作条「取消」：清选区（操作条随 selectionchange 收起） */
function cancelSelection(): void {
  toolbarVisible.value = false
  document.getSelection()?.removeAllRanges()
}

/** 点击处文本插入点：优先 caretRangeFromPoint；无布局环境退化为点击目标内
 *  首个文本节点开头（jsdom 测试路径） */
function caretPositionFromClick(e: MouseEvent): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  if (typeof doc.caretRangeFromPoint === 'function') {
    const r = doc.caretRangeFromPoint(e.clientX, e.clientY)
    return r ? { node: r.startContainer, offset: r.startOffset } : null
  }
  const target = e.target as HTMLElement | null
  if (!target) return null
  const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT)
  const node = walker.nextNode()
  return node ? { node, offset: 0 } : null
}

/** 正文点击：命中已绘制高亮 → 删除浮层；未命中 → 收起浮层。
 *  有活动选区时（刚划选，操作条在位）不弹删除浮层。 */
function onContentClick(e: MouseEvent): void {
  if (document.getSelection()?.isCollapsed === false) return
  const pos = caretPositionFromClick(e)
  if (pos) {
    for (const [id, range] of highlightRanges) {
      if (range.isPointInRange(pos.node, pos.offset)) {
        popoverHighlightId.value = id
        popoverX.value = Math.max(e.clientX, 8)
        popoverY.value = Math.max(e.clientY, 8)
        return
      }
    }
  }
  popoverHighlightId.value = null
}

/** 删除浮层「删除」：仅删高亮行（不删关联 Block，ADR-0040 D7） */
async function removeHighlight(): Promise<void> {
  const id = popoverHighlightId.value
  popoverHighlightId.value = null
  if (!id) return
  try {
    const client = await initCoreClient()
    await client.deleteBookHighlight(id)
  } catch (e) {
    console.warn('[reader] 高亮删除失败:', e)
    return
  }
  chapterHighlights.value = chapterHighlights.value.filter(h => h.id !== id)
  redrawHighlights()
}

onMounted(() => {
  const el = containerRef.value
  el?.addEventListener('scroll', onScroll, { passive: true })
  el?.addEventListener('wheel', onWheel, { passive: true })
  el?.addEventListener('click', onContentClick)
  document.addEventListener('selectionchange', onSelectionChange)
  void render()
})

onBeforeUnmount(() => {
  renderGeneration++
  releaseObjectUrls()
  const el = containerRef.value
  el?.removeEventListener('scroll', onScroll)
  el?.removeEventListener('wheel', onWheel)
  el?.removeEventListener('click', onContentClick)
  document.removeEventListener('selectionchange', onSelectionChange)
  // 清绘制层（避免高亮残留到下一章）
  ;(CSS as { highlights?: HighlightRegistry }).highlights?.delete(HIGHLIGHT_KEY)
  highlightRanges.clear()
  // 关窗/切章：flush 待写的 debounce 进度，保住最后位置
  if (saveTimer != null) {
    clearTimeout(saveTimer)
    saveTimer = null
    void saveProgress()
  }
})
</script>

<template>
  <div ref="containerRef" class="chapter-content"></div>

  <!-- 浮层 Teleport 到 body + var(--z-popover)（ADR-0032 浮层纪律） -->
  <SelectionToolbar
    :visible="toolbarVisible"
    :x="toolbarX"
    :y="toolbarY"
    @highlight="createHighlight"
    @note="startNoteFromSelection"
    @cancel="cancelSelection"
  />

  <HighlightPopover
    :visible="popoverHighlightId != null"
    :x="popoverX"
    :y="popoverY"
    @note="startNoteFromHighlight"
    @remove="removeHighlight"
    @close="popoverHighlightId = null"
  />

  <!-- 票 06：写笔记输入浮层（高亮原文上下文 + 想法输入） -->
  <NoteInputPopover
    :visible="noteDraft != null"
    :x="noteDraft?.x ?? 0"
    :y="noteDraft?.y ?? 0"
    :quote="noteDraft?.highlight.text"
    :initial-text="noteDraft?.initialText"
    @submit="submitNote"
    @close="noteDraft = null"
  />
</template>

<style lang="scss">
// 高亮绘制层（票 05）：CSS Custom Highlight API，等价 <mark> 包裹但不改
// DOM 结构（正文 DOM 稳定是 CFI 锚定/进度保存的前提）。非 scoped：
// ::highlight 伪元素规则带 scoped hash 会被编译成无效选择器；颜色继承
// 正文元素链上的 --reader-highlight（ReaderView 主题 class 中定义）。
::highlight(reader-highlight) {
  background-color: var(--reader-highlight, rgba(255, 213, 79, 0.55));
}

// 跳回原文闪烁提示（票 06）：临时注册的绘制层，强调色描边
::highlight(reader-jump-flash) {
  background-color: var(--accent, rgba(59, 130, 246, 0.28));
  outline: 2px solid var(--accent, #3b82f6);
}
</style>

<style lang="scss" scoped>
.chapter-content {
  height: 100%;
  overflow-y: auto;
  padding: 32px 24px 96px;
  // 排版参数（票 04）：变量由 ReaderView 落地到阅读器窗口根
  // （默认值仅兜底；正文色随主题在 ReaderView 主题 class 中切换）
  font-size: var(--reader-font-size, 1rem);
  line-height: var(--reader-line-height, 1.8);
  max-width: var(--reader-max-width, 42ch);
  margin: 0 auto;
  color: var(--reader-text, var(--text-primary));

  @for $i from 1 through 6 {
    :deep(h#{$i}) {
      font-size: var(--heading-#{$i});
      font-weight: var(--heading-#{$i}-weight);
      line-height: var(--leading-tight);
      margin: 1.2em 0 0.5em;
    }
  }

  :deep(p) {
    margin: 0.75em 0;
  }

  :deep(img) {
    max-width: 100%;
    height: auto;
    // 夜间主题不反色（主题为换色而非滤镜反转，图片天然保持原色）
  }

  :deep(blockquote) {
    margin: 1em 0;
    padding-left: 1em;
    border-left: 3px solid var(--border-strong);
    color: var(--text-secondary);
  }

  :deep(ul), :deep(ol) {
    margin: 0.75em 0;
    padding-left: 1.8em;
  }

  :deep(li) {
    margin: 0.25em 0;
  }

  :deep(table) {
    border-collapse: collapse;
    margin: 1em 0;
  }

  :deep(th), :deep(td) {
    border: 1px solid var(--border);
    padding: 6px 10px;
    text-align: left;
  }

  :deep(figure) {
    margin: 1em 0;
  }

  :deep(figcaption) {
    margin-top: 6px;
    font-size: var(--text-sm);
    color: var(--text-tertiary);
    text-align: center;
  }

  :deep(hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 2em 0;
  }

  :deep(pre) {
    background: var(--bg-hover);
    border-radius: var(--radius-md);
    padding: 12px;
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }
}
</style>
