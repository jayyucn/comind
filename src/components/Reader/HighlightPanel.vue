<script setup lang="ts">
// 高亮管理面板（票 07 / ADR-0040 D7/D10）：常驻侧栏——随阅读器正文区内联
// 布局，打开时占位收窄正文、关闭时折叠为 0 宽（同 TocDrawer 模式，无遮罩、
// 无 Teleport、无 z-index）。列出本书全部高亮（按章节分组、创建时间倒序），
// 有笔记的经 block_id join 书 Page blocks 显示想法摘要。点条目 → 父级 CFI
// 定位（复用票 06 jumpCfi 机制，侧栏保持常驻）；删除高亮时联动删除其笔记
// Block（不留孤儿块），已有笔记的条目删除前二次确认；
// 追加/修改笔记复用票 06 NoteInputPopover（自 Teleport 到 body）。
import { computed, ref, watch } from 'vue'
import { useBlockStore } from '../../stores/blocks'
import { createOrUpdateNoteBlock, deleteNoteHighlight, loadNoteText } from '../../services/book-note'
import { cfiToSpineIndex } from '../../services/epub-cfi'
import { initCoreClient } from '../../wasm/client'
import type { BookHighlightRust } from '../../wasm/types'
import Icon from '../Icons/Icon.vue'
import NoteInputPopover from './NoteInputPopover.vue'

const props = defineProps<{
  open: boolean
  /** 书 Page id（高亮/笔记 Block 的归属页） */
  bookId: string
  /** 书名（笔记 Block 的 book 属性快照） */
  bookTitle: string
}>()

const emit = defineEmits<{
  close: []
  /** 点条目：定位到该高亮原文（父级关抽屉 + 走 jumpCfi 定位） */
  locate: [cfi: string]
  /** 高亮数据变更（删除）：父级通知正文重载重绘 */
  changed: []
}>()

type Phase = 'loading' | 'ready' | 'error'

const phase = ref<Phase>('loading')
/** 本书全部高亮行（打开面板时从库读取） */
const highlights = ref<BookHighlightRust[]>([])

/** 书 Page blocks（join 笔记摘要的数据源；阅读器窗口独立 Pinia） */
const blockStore = useBlockStore()

/** 待删除确认的条目 id（已有笔记的二次确认态），null = 无确认 */
const confirmDeleteId = ref<string | null>(null)

/** 写笔记浮层上下文（票 06 复用），null = 隐藏 */
interface NoteDraft {
  x: number
  y: number
  highlight: BookHighlightRust
  /** 已有笔记的预填文本（更新路径） */
  initialText?: string
}
const noteDraft = ref<NoteDraft | null>(null)

/** 面板条目：高亮行 + join 出的想法摘要 */
interface PanelItem {
  highlight: BookHighlightRust
  note: string | null
}

/** block_id → 笔记摘要（书 Page blocks join；Block 不在库中则无摘要） */
const noteSummaries = computed(() => {
  const ids = new Set(
    highlights.value.map(h => h.block_id).filter((x): x is string => x != null),
  )
  const map = new Map<string, string>()
  for (const b of blockStore.blocks) {
    if (ids.has(b.id)) map.set(b.id, b.content)
  }
  return map
})

/** 按章节分组：组间按书内 spine 顺序（前缀解析，未知殿后），组内创建时间倒序 */
const groups = computed(() => {
  const byChapter = new Map<string, PanelItem[]>()
  for (const h of highlights.value) {
    const key = h.chapter || '（未命名章节）'
    const list = byChapter.get(key) ?? []
    list.push({
      highlight: h,
      note: h.block_id ? noteSummaries.value.get(h.block_id) ?? null : null,
    })
    byChapter.set(key, list)
  }
  const out: { chapter: string; spineIndex: number | null; items: PanelItem[] }[] = []
  for (const [chapter, items] of byChapter) {
    items.sort((a, b) => b.highlight.created_at - a.highlight.created_at)
    // 组的 spine 序号取组内首个可解析条目（前缀异常的条目不影响组排序）
    const spineIndex =
      items.map(i => cfiToSpineIndex(i.highlight.cfi)).find(i => i != null) ?? null
    out.push({ chapter, spineIndex, items })
  }
  out.sort((a, b) => {
    if (a.spineIndex == null) return 1
    if (b.spineIndex == null) return -1
    return a.spineIndex - b.spineIndex
  })
  return out
})

/** 打开面板时加载：高亮行 + 书 Page blocks（join 摘要；blocks 加载失败静默降级） */
async function load(): Promise<void> {
  phase.value = 'loading'
  confirmDeleteId.value = null
  try {
    const client = await initCoreClient()
    const [rows] = await Promise.all([
      client.getBookHighlights(props.bookId),
      blockStore.loadPageBlocks(props.bookId).catch(() => undefined),
    ])
    highlights.value = rows
    phase.value = 'ready'
  } catch (e) {
    console.warn('[reader] 高亮面板加载失败:', e)
    phase.value = 'error'
  }
}

watch(
  () => props.open,
  open => {
    if (open) void load()
  },
  { immediate: true },
)

/** 删除按钮：已有笔记的先二次确认（确认后联动删除笔记 Block），无笔记直接删 */
function requestRemove(item: PanelItem): void {
  if (item.highlight.block_id) {
    confirmDeleteId.value = item.highlight.id
    return
  }
  void removeHighlight(item.highlight)
}

/** 确认删除（已有笔记条目的二次确认分支） */
function confirmRemove(): void {
  const id = confirmDeleteId.value
  confirmDeleteId.value = null
  if (!id) return
  const h = highlights.value.find(x => x.id === id)
  if (h) void removeHighlight(h)
}

/** 删高亮行 + 联动删除其笔记 Block；成功后本地列表移除 + 通知正文重绘 */
async function removeHighlight(highlight: BookHighlightRust): Promise<void> {
  try {
    await deleteNoteHighlight(props.bookId, highlight)
  } catch (e) {
    console.warn('[reader] 高亮/笔记删除失败:', e)
    return
  }
  highlights.value = highlights.value.filter(h => h.id !== highlight.id)
  emit('changed')
}

/** 「写笔记」：已有 block_id 预填旧文（更新路径），否则新建；浮层浮现于点击处 */
async function startNote(item: PanelItem, e: MouseEvent): Promise<void> {
  let initialText: string | undefined
  if (item.highlight.block_id) {
    try {
      initialText = await loadNoteText(item.highlight.block_id)
    } catch {
      // 库中无此 block（异常数据）：按新建处理
    }
  }
  // x 钳制：浮层以 (x,y) 为顶边中点展开（宽 320），避免贴左边界溢出
  noteDraft.value = {
    x: Math.max(e.clientX, 172),
    y: Math.max(e.clientY, 8),
    highlight: item.highlight,
    initialText,
  }
}

/** 输入浮层提交：走 book-note 写路径（新建/更新 Block + 属性 + 回填） */
async function submitNote(text: string): Promise<void> {
  const draft = noteDraft.value
  noteDraft.value = null
  if (!draft) return
  try {
    const { highlight } = await createOrUpdateNoteBlock({
      bookPageId: props.bookId,
      bookTitle: props.bookTitle,
      chapter: draft.highlight.chapter,
      cfi: draft.highlight.cfi,
      quote: draft.highlight.text,
      text,
      highlight: draft.highlight,
    })
    // 本地列表同步回填的 block_id（摘要 join store blocks 即时反映）
    const idx = highlights.value.findIndex(h => h.id === highlight.id)
    if (idx >= 0) highlights.value[idx] = highlight
  } catch (e) {
    console.warn('[reader] 笔记保存失败:', e)
  }
}
</script>

<template>
  <aside class="highlight-panel" :class="{ collapsed: !open }" aria-label="本书高亮">
    <header class="panel-header">
      <span class="panel-title">本书高亮</span>
      <button class="panel-close-btn" title="关闭高亮面板" @click="emit('close')">
        <Icon name="icon-close" :size="16" />
      </button>
    </header>
    <div class="panel-body">
      <div v-if="phase === 'loading'" class="panel-status">加载中…</div>
      <div v-else-if="phase === 'error'" class="panel-status">高亮加载失败，请重试</div>
      <div v-else-if="groups.length === 0" class="panel-status">
        还没有高亮，选中正文即可划线
      </div>
      <template v-else>
        <section v-for="group in groups" :key="group.chapter" class="chapter-group">
          <h3 class="group-title" :title="group.chapter">{{ group.chapter }}</h3>
          <article
            v-for="item in group.items"
            :key="item.highlight.id"
            class="highlight-item"
          >
            <button
              class="item-quote"
              :title="item.highlight.text"
              @click="emit('locate', item.highlight.cfi)"
            >{{ item.highlight.text }}</button>
            <p v-if="item.note" class="item-note" :title="item.note">想法：{{ item.note }}</p>
            <div class="item-actions">
              <button class="item-btn" title="写笔记" @click="startNote(item, $event)">
                写笔记
              </button>
              <template v-if="confirmDeleteId === item.highlight.id">
                <span class="confirm-hint">笔记 Block 将一并删除</span>
                <button class="item-btn danger confirm-ok" @click="confirmRemove">确认删除</button>
                <button class="item-btn confirm-cancel" @click="confirmDeleteId = null">取消</button>
              </template>
              <button
                v-else
                class="item-btn danger"
                title="删除高亮"
                @click="requestRemove(item)"
              >删除</button>
            </div>
          </article>
        </section>
      </template>
    </div>

    <!-- 票 06 写笔记输入浮层（外壳复用 BasePopover） -->
    <NoteInputPopover
      :visible="noteDraft != null"
      :x="noteDraft?.x ?? 0"
      :y="noteDraft?.y ?? 0"
      :initial-text="noteDraft?.initialText"
      @submit="submitNote"
      @close="noteDraft = null"
    />
  </aside>
</template>

<style lang="scss" scoped>
.highlight-panel {
  width: 320px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--reader-bg);
  border-left: 1px solid var(--reader-border);
  overflow: hidden;
  transition: width 160ms ease;

  &.collapsed {
    width: 0;
    border-left: none;
    visibility: hidden;
  }
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 8px 0 16px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--reader-border);
}

.panel-title {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--reader-text);
  white-space: nowrap;
}

.panel-close-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  color: var(--reader-text-muted);
  transition: all 100ms ease;

  &:hover {
    background: var(--bg-hover);
    color: var(--reader-text);
  }
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.panel-status {
  padding: 24px 16px;
  font-size: var(--text-sm);
  color: var(--reader-text-muted);
  text-align: center;
}

.chapter-group {
  & + & {
    border-top: 1px solid var(--reader-border);
    margin-top: 4px;
    padding-top: 4px;
  }
}

.group-title {
  margin: 0;
  padding: 8px 16px 4px;
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  color: var(--reader-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.highlight-item {
  padding: 8px 12px 8px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;

  &:hover {
    background: var(--bg-hover);
  }
}

.item-quote {
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  padding: 0;
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  color: var(--reader-text);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;

  &:hover {
    color: var(--accent);
  }
}

.item-note {
  margin: 0;
  padding-left: 8px;
  border-left: 2px solid var(--accent);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  color: var(--reader-text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.item-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.confirm-hint {
  font-size: var(--text-xs);
  color: var(--reader-text-muted);
  margin-right: 2px;
}

.item-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  height: 22px;
  padding: 0 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  color: var(--reader-text-muted);
  transition: all 100ms ease;
  white-space: nowrap;

  &:hover {
    background: var(--bg-active, var(--bg-hover));
    color: var(--reader-text);
  }

  &.danger:hover {
    color: var(--color-error, #d93025);
  }
}
</style>
