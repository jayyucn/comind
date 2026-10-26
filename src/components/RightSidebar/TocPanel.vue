<script setup lang="ts">
// 右栏「大纲」面板 tab（ADR-0059 D6）：绑定 currentPageId（= 活动 pane 页），
// 与「图谱」并列。标题/书章提取复用原 Toc 口径；点击定位与滚动高亮按活动 pane 的
// 滚动容器路由（不再依赖全局 navigate-to-block 事件，避免双 Page 实例双监听串扰）。
import { TextAlignStart } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { buildTree } from '../../composables/useBlockTree'
import { parseHeading } from '../../composables/useContentRenderer'
import { openReaderWindow } from '../../composables/useReaderWindow'
import { type BookNoteMeta,groupBookNotesByChapter } from '../../services/book-notes-group'
import { useBlockStore } from '../../stores/blocks'
import { useFieldValueStore } from '../../stores/fieldValue'
import { usePageStore } from '../../stores/pages'
import { usePanesStore } from '../../stores/panes'
import type { Block, TreeNode } from '../../types/block'
import { decodeFieldValueData } from '../../utils/field-value-codec'
import { isTauriEnvironment } from '../../wasm/tauri-platform'
import TocItem, { type TocNode } from '../Page/TocItem.vue'

const pageStore = usePageStore()
const blockStore = useBlockStore()
const fieldValueStore = useFieldValueStore()
const panesStore = usePanesStore()

const pageId = computed(() => pageStore.currentPageId)
const page = computed(() => pageStore.getPage(pageId.value) ?? null)
const isBook = computed(() => page.value?.type === 'book')
const rootBlockId = computed(() => page.value?.blockId ?? null)

const tree = computed<TreeNode[]>(() =>
  buildTree(blockStore.blocks, pageId.value, rootBlockId.value),
)

function propValue(blockId: string, key: string): string {
  const p = fieldValueStore.getBlockFieldValues(blockId).find(x => x.key === key && x.deleted_at === null)
  return p ? String(decodeFieldValueData(p.value_json, p.value_type)) : ''
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
 * 提取块中的标题信息（与原 Toc 同口径）：编辑器手打 `#{1,6} ` 前缀优先，
 * 模板插入的 format.type==='heading' + format.level 兜底。
 */
function extractHeading(b: Block): { level: number; title: string } | null {
  const parsed = parseHeading(b.content)
  if (parsed) return { level: parsed.level, title: parsed.title }
  if (b.format?.type === 'heading') {
    return { level: Number(b.format?.level ?? 2), title: b.content }
  }
  return null
}

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

const noteIds = computed(() => tree.value.map(n => n.id))
watch(
  noteIds,
  ids => {
    if (isBook.value && ids.length > 0) void fieldValueStore.loadMultiBlockFieldValues(ids)
  },
  { immediate: true },
)

const canJump = computed(() => isTauriEnvironment())

// ── 活动 pane 滚动容器解析 ──
function paneScroller(): HTMLElement | null {
  const paneEl = document.querySelector<HTMLElement>(`[data-pane-id="${panesStore.activePaneId}"]`)
  return paneEl?.querySelector<HTMLElement>('.pane-body') ?? null
}

/** 点击定位：直接在活动 pane 的滚动容器内滚动到对应块 */
function locate(blockId: string): void {
  const scroller = paneScroller()
  const el = scroller?.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('navigate-highlight')
  window.setTimeout(() => el.classList.remove('navigate-highlight'), 2000)
}

function jump(cfi: string): void {
  void openReaderWindow(pageId.value, { jumpCfi: cfi })
}

// ── 滚动联动高亮（scroll-spy，作用域限定活动 pane）──
const activeId = ref('')

function flattenToc(list: TocNode[]): TocNode[] {
  const out: TocNode[] = []
  for (const n of list) {
    out.push(n)
    out.push(...flattenToc(n.children))
  }
  return out
}

function computeActive(): void {
  const scroller = paneScroller()
  if (!scroller) {
    activeId.value = ''
    return
  }
  const ids = flattenToc(nodes.value)
    .map(n => n.blockId)
    .filter(Boolean)
  if (ids.length === 0) {
    activeId.value = ''
    return
  }
  const threshold = scroller.getBoundingClientRect().top + 100
  let current = ''
  for (const id of ids) {
    const el = scroller.querySelector<HTMLElement>(`[data-block-id="${id}"]`)
    if (!el) continue
    if (el.getBoundingClientRect().top <= threshold) current = id
    else break
  }
  activeId.value = current
}

let rafId = 0
function onScroll(): void {
  if (rafId) return
  rafId = requestAnimationFrame(() => {
    rafId = 0
    computeActive()
  })
}

onMounted(() => {
  // scroll 不冒泡但会被 window 捕获；无论活动 pane 内哪个容器滚动都能触发重算
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', onScroll)
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', onScroll)
  if (rafId) cancelAnimationFrame(rafId)
})

watch(nodes, () => nextTick(computeActive))
watch(
  () => panesStore.activePaneId,
  () => nextTick(computeActive),
)
</script>

<template>
  <div class="toc-panel">
    <div
      v-if="nodes.length === 0"
      class="toc-empty"
    >
      <TextAlignStart
        :size="16"
        class="toc-empty-icon"
      />
      <span>无标题</span>
    </div>
    <ul
      v-else
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
  </div>
</template>

<style lang="scss" scoped>
.toc-panel {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.toc-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px 8px;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}

.toc-empty-icon {
  opacity: 0.5;
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
</style>
