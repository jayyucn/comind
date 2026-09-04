<script setup lang="ts">
// 通用 TOC 浮层（替代原 BookNotesOutline）：
// - 普通页：扫描标题块（content `#{1,6} ` 前缀或 format.type==='heading'），按 level 嵌套成文档大纲；
// - 书页：复用 part/chapter/cfi 属性投影（book-notes-group）；
// - 点击行 dispatch navigate-to-block（Page/index.vue 监听滚动+高亮）；
//   书源叶子节点带 cfi 时显示「原文」跳回阅读器。
// 浮层 Teleport 到 body，固定定位在左侧留白带，窄屏自动隐藏，可收起。
import { computed, ref, watch } from 'vue'
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
</script>

<template>
  <Teleport to="body">
    <div
      v-if="nodes.length > 0"
      class="toc-panel"
      :class="{ 'is-collapsed': collapsed }"
    >
      <template v-if="!collapsed">
        <div class="toc-head">
          <span class="toc-title">目录</span>
          <span class="toc-count">{{ count }}</span>
          <button
            class="toc-toggle"
            title="收起目录"
            @click="collapsed = true"
          >
            «
          </button>
        </div>
        <ul class="toc-list">
          <TocItem
            v-for="n in nodes"
            :key="n.id"
            :node="n"
            :depth="0"
            :can-jump="canJump"
            @locate="locate"
            @jump="jump"
          />
        </ul>
      </template>
      <button
        v-else
        class="toc-reopen"
        title="展开目录"
        @click="collapsed = false"
      >
        目录
      </button>
    </div>
  </Teleport>
</template>

<style lang="scss" scoped>
.toc-panel {
  position: fixed;
  top: calc(var(--nav-height) + 16px);
  left: calc(var(--sidebar-width) + 16px);
  width: 232px;
  max-height: calc(100vh - var(--nav-height) - 32px);
  display: flex;
  flex-direction: column;
  background: var(--bg-base2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.1);
  z-index: var(--z-sidebar);
  overflow: hidden;

  // 窄屏：左侧留白带不足，隐藏浮层（Q10：<1100px 自动隐藏）
  @media (max-width: 1100px) {
    display: none;
  }
}

.toc-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.toc-title {
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--text-secondary);
}

.toc-count {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.toc-toggle {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: var(--text-sm);
  line-height: 1;
  padding: 2px 4px;
  border-radius: var(--radius-sm);

  &:hover {
    background: var(--bg-hover);
    color: var(--text-secondary);
  }
}

.toc-list {
  list-style: none;
  margin: 0;
  padding: 4px;
  overflow-y: auto;
  flex: 1;
}

.toc-reopen {
  margin: 0;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: var(--text-xs);
  padding: 8px 12px;
  border-radius: var(--radius-sm);

  &:hover {
    background: var(--bg-hover);
    color: var(--text-secondary);
  }
}
</style>
