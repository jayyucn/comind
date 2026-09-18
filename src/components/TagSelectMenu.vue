<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { EditorView } from '@tiptap/pm/view'
import type { Editor } from '@tiptap/vue-3'
import { useEditorStore } from '../stores/editor'
import { usePageStore } from '../stores/pages'
import { useTagStore } from '../composables/useTagStore'
import { parseTagQuery } from '../extensions/TagInputExtension'
import BasePopover from './common/BasePopover.vue'

/**
 * 打标签输入选择器（#132 / ADR-0049）。
 *
 * 监听编辑器 `#` 派发的 `tag-input-trigger`，列出已有标签页并支持「创建 #X」。
 * 选中/回车即 `applyTag`（不存在则先 `createTagPage`），随后删除编辑器内 `#word` 文本。
 * 与斜杠命令（`/`）、关系菜单（`[[`）前缀正交，互不冲突（E5）。
 */

const editorStore = useEditorStore()
const pageStore = usePageStore()
const tagStore = useTagStore()

const visible = ref(false)
const query = ref('')
const selectedIndex = ref(0)
const position = ref({ x: 0, y: 0 })
const range = ref<{ from: number; to: number } | null>(null)
const listRef = ref<HTMLElement | null>(null)

// 锚点：跟随光标（同 SlashCommandMenu，ADR-0038）
const anchorView = shallowRef<EditorView | null>(null)
const anchorPos = ref(0)

interface Candidate {
  kind: 'existing' | 'create'
  id: string
  title: string
}

const existingTags = computed(() => pageStore.pages.filter(p => p.type === 'tag' && !p.deleted))

const candidates = computed<Candidate[]>(() => {
  const raw = query.value.trim()
  const q = raw.toLowerCase()
  const matched = existingTags.value
    .filter(p => !q || p.title.toLowerCase().includes(q))
    .slice(0, 20)
    .map((p): Candidate => ({ kind: 'existing', id: p.id, title: p.title }))
  const exact = q.length > 0 && existingTags.value.some(p => p.title.toLowerCase() === q)
  const list: Candidate[] = [...matched]
  if (q && !exact) list.push({ kind: 'create', id: `__create__${raw}`, title: raw })
  return list
})

function anchorFromView(view: EditorView, pos: number): HTMLElement | null {
  try {
    const { node } = view.domAtPos(pos)
    return node.nodeType === Node.TEXT_NODE ? (node.parentElement as HTMLElement) : (node as HTMLElement)
  } catch {
    return null
  }
}

const anchorElProp = computed<HTMLElement | (() => HTMLElement | null) | undefined>(() => {
  const view = anchorView.value
  return view ? () => anchorFromView(view, anchorPos.value) : undefined
})

function handleTagTrigger(event: Event) {
  const detail = (event as CustomEvent<{ view: EditorView; position: number; range: { from: number; to: number } }>).detail
  const view = detail.view
  const coords = view.coordsAtPos(detail.position)

  visible.value = true
  position.value = { x: coords.left, y: coords.bottom + 8 }
  anchorView.value = view
  anchorPos.value = detail.position
  range.value = detail.range
  query.value = ''
  selectedIndex.value = 0
}

/** 从编辑器同步 `#` 后的查询词（range 失效/不以 # 开头则视为无法确认） */
function syncQuery(): boolean {
  if (!visible.value || !range.value) return false
  const editor = editorStore.activeEditor
  if (!editor) return false
  const cursor = editor.state.selection.from
  if (cursor < range.value.from) return false
  const text = editor.state.doc.textBetween(range.value.from, cursor)
  if (!text.startsWith('#')) return false
  const q = parseTagQuery(text.slice(1)) ?? ''
  if (q !== query.value) {
    query.value = q
    selectedIndex.value = 0
  }
  return true
}

let boundEditor: Editor | null = null
let boundEditorDom: HTMLElement | null = null
let editorUpdateListener: (() => void) | null = null

function bindEditorUpdate() {
  const editor = editorStore.activeEditor
  if (!editor) return
  if (boundEditor === editor) return
  unbindEditorUpdate()
  editorUpdateListener = () => syncQuery()
  editor.on?.('update', editorUpdateListener)
  const dom = editor.view?.dom as HTMLElement | undefined
  if (dom) {
    dom.addEventListener('compositionend', editorUpdateListener)
    boundEditorDom = dom
  }
  boundEditor = editor
}

function unbindEditorUpdate() {
  if (!editorUpdateListener) return
  boundEditor?.off?.('update', editorUpdateListener)
  boundEditorDom?.removeEventListener('compositionend', editorUpdateListener)
  boundEditor = null
  boundEditorDom = null
  editorUpdateListener = null
}

function close() {
  visible.value = false
  range.value = null
  anchorView.value = null
  query.value = ''
}

/** 选中候选：删 `#word` → 贴标签（不存在则创建） */
async function choose(c: Candidate) {
  const editor = editorStore.activeEditor
  const blockId = editorStore.activeBlockId
  const r = range.value
  if (!editor || !blockId || !r) {
    close()
    return
  }

  const cursor = editor.state.selection.from
  editor.chain().deleteRange({ from: r.from, to: cursor }).focus().run()
  close()

  const tagPageId = c.kind === 'existing' ? c.id : (await pageStore.createTagPage(c.title)).id
  await tagStore.applyTag(blockId, tagPageId)
}

function handleKeyDown(event: KeyboardEvent) {
  if (!visible.value) return
  if (event.isComposing || event.keyCode === 229) return

  const listLength = candidates.value.length
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      if (listLength === 0) return
      selectedIndex.value = (selectedIndex.value + 1) % listLength
      break
    case 'ArrowUp':
      event.preventDefault()
      if (listLength === 0) return
      selectedIndex.value = selectedIndex.value <= 0 ? listLength - 1 : selectedIndex.value - 1
      break
    case 'Enter': {
      event.preventDefault()
      if (!syncQuery()) { close(); break }
      const c = candidates.value[selectedIndex.value]
      if (c) void choose(c)
      break
    }
    case 'Escape':
      event.preventDefault()
      close()
      break
  }
}

function scrollToSelected() {
  nextTick(() => {
    if (!listRef.value) return
    const items = listRef.value.querySelectorAll('.tag-select-item')
    const selected = items[selectedIndex.value] as HTMLElement | undefined
    selected?.scrollIntoView({ block: 'nearest' })
  })
}

watch(selectedIndex, () => { if (visible.value) scrollToSelected() })

watch(visible, (isVisible) => {
  if (isVisible) {
    bindEditorUpdate()
    nextTick(scrollToSelected)
  } else {
    unbindEditorUpdate()
  }
})

watch(() => editorStore.activeEditor, () => { if (visible.value) bindEditorUpdate() })

onMounted(async () => {
  document.addEventListener('tag-input-trigger', handleTagTrigger as EventListener)
  document.addEventListener('keydown', handleKeyDown, true)
  await pageStore.ensurePagesLoaded()
})

onBeforeUnmount(() => {
  document.removeEventListener('tag-input-trigger', handleTagTrigger as EventListener)
  document.removeEventListener('keydown', handleKeyDown, true)
  unbindEditorUpdate()
})
</script>

<template>
  <BasePopover
    :visible="visible"
    :position="position"
    :anchor-el="anchorElProp || null"
    placement="bottom"
    @close="close"
  >
    <div class="tag-select-menu">
      <div
        ref="listRef"
        class="tag-select-list"
      >
        <div class="tag-select-group-title">
          标签
        </div>
        <div
          v-for="(c, idx) in candidates"
          :key="c.id"
          class="tag-select-item"
          :class="{ selected: idx === selectedIndex }"
          @click="choose(c)"
          @mouseenter="selectedIndex = idx"
        >
          <span class="tag-select-icon">🏷️</span>
          <span class="tag-select-name">{{ c.kind === 'create' ? `创建 “${c.title}”` : c.title }}</span>
        </div>
        <div
          v-if="candidates.length === 0"
          class="tag-select-empty"
        >
          输入标签名
        </div>
      </div>
    </div>
  </BasePopover>
</template>

<style scoped>
.tag-select-menu {
  width: var(--panel-width-sm);
  max-height: 360px;
  overflow: hidden;
}

.tag-select-list {
  overflow-y: auto;
  max-height: 360px;
  padding: 4px 0;
}

.tag-select-group-title {
  padding: 6px 12px;
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: var(--letter-wide-2);
}

.tag-select-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.tag-select-item.selected {
  background: var(--accent-subtle, rgba(180, 83, 9, 0.08));
  border-left: 2px solid var(--accent, #B45309);
  padding-left: 10px;
}

.tag-select-item:hover {
  background: var(--bg-hover, #F5F5F4);
}

.tag-select-icon {
  display: inline-flex;
  align-items: center;
  font-size: var(--text-sm);
}

.tag-select-name {
  color: var(--text-primary);
  font-size: var(--text-sm);
}

.tag-select-empty {
  padding: 8px 12px;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}
</style>
