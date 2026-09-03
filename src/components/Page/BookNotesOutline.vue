<script setup lang="ts">
// 书 Page 的「按章浏览」大纲（ADR-0040 D7 后续 / B 方案 v1：结构=属性投影）。
// 书 Page 的笔记块在写入时已固化 part(章)/chapter(节)/cfi 快照（阅读器完成 TOC
// 解析）。本组件把平铺块流按属性聚合成 章→节 大纲：点击行滚动定位到组内首条
// 笔记（dispatch navigate-to-block，Page/index.vue 监听滚动+高亮）；行尾「原文」
// 唤起阅读器跳回该组首条笔记的高亮位置（复用票 06 jumpCfi 机制）。
// 纯展示投影：不改块树、无只读概念、不侵入 BlockList。
import { ChevronRight } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { usePageStore } from '../../stores/pages'
import { useBlockStore } from '../../stores/blocks'
import { usePropertyStore } from '../../stores/property'
import { buildTree } from '../../composables/useBlockTree'
import { groupBookNotesByChapter, type BookNoteMeta } from '../../services/book-notes-group'
import { openReaderWindow } from '../../composables/useReaderWindow'
import { isTauriEnvironment } from '../../wasm/tauri-platform'

const props = defineProps<{
  /** 书 Page id（type='book'，id 即阅读器 bookId） */
  pageId: string
}>()

const pageStore = usePageStore()
const blockStore = useBlockStore()
const propertyStore = usePropertyStore()

/** 根块（page.blockId）下的文档序一级块 = 笔记流 */
const rootBlockId = computed(() => pageStore.getPage(props.pageId)?.blockId ?? null)
const tree = computed(() => buildTree(blockStore.blocks, props.pageId, rootBlockId.value))
const noteIds = computed(() => tree.value.map(n => n.id))

function propValue(blockId: string, key: string): string {
  const p = propertyStore.getBlockProperties(blockId).find(x => x.key === key && !x.isDeleted)
  return p ? String(p.value) : ''
}

/** 书笔记归属快照（part/chapter/cfi 来自 Property 表） */
const notes = computed<BookNoteMeta[]>(() =>
  tree.value.map(n => ({
    blockId: n.id,
    part: propValue(n.id, 'part'),
    chapter: propValue(n.id, 'chapter'),
    cfi: propValue(n.id, 'cfi') || null,
  })))

const groups = computed(() => groupBookNotesByChapter(notes.value))
const totalCount = computed(() => groups.value.reduce((sum, g) => sum + g.count, 0))

/** 根块集变化（页面打开/跨窗口刷新后）→ 拉取属性，属性到位后分组自然更新 */
watch(noteIds, ids => {
  if (ids.length > 0) void propertyStore.loadMultiBlockProperties(ids)
}, { immediate: true })

/** 折叠的章标题（默认全展开；数据新增的章不在集合内=展开） */
const collapsed = ref<Set<string>>(new Set())

function isCollapsed(title: string): boolean {
  return collapsed.value.has(title)
}

function toggleChapter(title: string): void {
  const next = new Set(collapsed.value)
  if (next.has(title)) next.delete(title)
  else next.add(title)
  collapsed.value = next
}

/** 滚动定位到目标笔记（Page/index.vue 的 navigate-to-block 监听负责滚动+高亮） */
function locate(blockId: string): void {
  window.dispatchEvent(new CustomEvent('navigate-to-block', { detail: { blockId } }))
}

/** 行尾「原文」：唤起该书阅读器并定位到高亮（bookPageId 即本页 id） */
function canJump(cfi: string | null): boolean {
  return isTauriEnvironment() && !!cfi
}

function jumpToSource(cfi: string): void {
  void openReaderWindow(props.pageId, { jumpCfi: cfi })
}
</script>

<template>
  <div
    v-if="groups.length > 0"
    class="book-notes-outline"
  >
    <div class="outline-head">
      <span class="outline-title">本书笔记</span>
      <span class="outline-count">{{ totalCount }} 条</span>
    </div>
    <ul class="outline-list">
      <li
        v-for="group in groups"
        :key="group.title"
        class="chapter"
      >
        <div
          class="chapter-row"
          @click="locate(group.first.blockId)"
        >
          <ChevronRight
            v-if="group.sections.length > 0"
            class="chev"
            :class="{ open: !isCollapsed(group.title) }"
            :size="14"
            @click.stop="toggleChapter(group.title)"
          />
          <span
            v-else
            class="chev-placeholder"
          />
          <span class="row-title">{{ group.title }}</span>
          <span class="row-count">{{ group.count }}</span>
          <button
            v-if="!group.sections.length && canJump(group.first.cfi)"
            class="jump-btn"
            title="回到书中该位置"
            @click.stop="jumpToSource(group.first.cfi!)"
          >
            原文
          </button>
        </div>
        <ul
          v-if="group.sections.length > 0 && !isCollapsed(group.title)"
          class="sections"
        >
          <li
            v-for="section in group.sections"
            :key="section.title"
            class="section-row"
            @click="locate(section.first.blockId)"
          >
            <span class="row-title">{{ section.title }}</span>
            <span class="row-count">{{ section.count }}</span>
            <button
              v-if="canJump(section.first.cfi)"
              class="jump-btn"
              title="回到书中该位置"
              @click.stop="jumpToSource(section.first.cfi!)"
            >
              原文
            </button>
          </li>
        </ul>
      </li>
    </ul>
  </div>
</template>

<style lang="scss" scoped>
.book-notes-outline {
  margin: var(--space-3) auto 0;
  max-width: 680px;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-base2);
}

.outline-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding-bottom: 6px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--border);
}

.outline-title {
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--text-secondary);
}

.outline-count {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.outline-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.chapter-row,
.section-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  user-select: none;

  &:hover {
    background: var(--bg-hover);
  }
}

.section-row {
  padding-left: 22px;
}

.row-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-sm);
  color: var(--text-primary);
}

.section-row .row-title {
  color: var(--text-secondary);
  font-size: 13px;
}

.row-count {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.chev {
  flex-shrink: 0;
  color: var(--text-tertiary);
  transition: transform 120ms ease;

  &.open {
    transform: rotate(90deg);
  }
}

.chev-placeholder {
  width: 14px;
  flex-shrink: 0;
}

.jump-btn {
  flex-shrink: 0;
  border: none;
  background: transparent;
  padding: 0 4px;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: var(--radius-sm);
  opacity: 0;
  transition: opacity 100ms ease, color 100ms ease;

  &:hover {
    color: var(--accent);
  }
}

.chapter-row:hover .jump-btn,
.section-row:hover .jump-btn {
  opacity: 1;
}
</style>
