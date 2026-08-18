<script setup lang="ts">
import { onBeforeUnmount, watch, shallowRef, ref } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { WikiLinkExtension } from '../extensions/WikiLinkExtension'
import { WikiLinkTriggerExtension, notifyWikiLinkMenuSelect, closeWikiLinkMenuByEditor, findWikiLinkAtCursor } from '../extensions/WikiLinkTriggerExtension'
import { RelationshipTriggerExtension } from '../extensions/RelationshipTriggerExtension'
import EnterAsBlockExtension from '../extensions/EnterAsBlockExtension'
import BracketPairExtension from '../extensions/BracketPairExtension'
import { SlashCommandExtension } from '../extensions/SlashCommandExtension'
import { HeadingPreviewExtension } from '../extensions/HeadingPreviewExtension'
import { DateRefExtension } from '../extensions/DateRefExtension'
import { DateRefTriggerExtension } from '../extensions/DateRefTriggerExtension'
import { usePageStore } from '../stores/pages'
import { useDateTimePickerPanel } from '../composables/useDateTimePickerPanel'
import { useRelationshipMenu } from '../composables/useRelationshipMenu'
import { debounce } from '../utils/debounce'
import PageLinkMenu from './PageLinkMenu.vue'
import DateRefKindSelector from './DateRefKindSelector.vue'
import type { DateRefKind } from '../utils/date-ref'
import { createEditorEvents } from './Block/editorEvents'
import { useDomEvents } from '../composables/useDomEvents'

const props = defineProps<{
  blockId: string
  content: string
  showFullPlaceholder?: boolean
  readonly?: boolean
}>()

const emit = defineEmits<{
  (e: 'save', content: string): void
  (e: 'split', cursorPos: number): void
  (e: 'merge'): void
  (e: 'delete'): void
  (e: 'indent'): void
  (e: 'outdent'): void
  (e: 'moveUp'): void
  (e: 'moveDown'): void
  (e: 'exitEdit'): void
  (e: 'cursor-change', pos: number): void
}>()

let syncing = false
let savedFromOutside = false

const debouncedEmitSave = debounce((content: string) => {
  emit('save', content)
}, 300)

function cancelDebouncedSave() {
  debouncedEmitSave.cancel()
}

const hasContent = ref(!!props.content)
const menuVisible = ref(false)
const menuPosition = ref({ x: 0, y: 0 })
const menuRange = ref({ from: 0, to: 0 })
const menuQuery = ref('')
const menuRef = ref<InstanceType<typeof PageLinkMenu> | null>(null)

// DateRef kind 选择器状态
const kindSelectorVisible = ref(false)
const kindSelectorPosition = ref({ left: 0, top: 0, bottom: 0 })
const kindSelectorRange = ref({ from: 0, to: 0 })
const kindSelectorView = ref<any>(null)

const relMenu = useRelationshipMenu()
const { open: openDateRefPanel } = useDateTimePickerPanel()

const editor = shallowRef(useEditor({
  extensions: [
    StarterKit.configure({ heading: false, codeBlock: false, blockquote: false, horizontalRule: false }),
    SlashCommandExtension,
    EnterAsBlockExtension,
    WikiLinkExtension,
    WikiLinkTriggerExtension,
    RelationshipTriggerExtension,
    BracketPairExtension,
    HeadingPreviewExtension,
    DateRefExtension,
    DateRefTriggerExtension,
  ],
  content: textToHtml(props.content),
  autofocus: false,
  editable: !props.readonly,
  onBlur: () => {
    if (syncing) return
    if (savedFromOutside) {
      savedFromOutside = false
      return
    }
    if (props.readonly) return
    if (editor.value) {
      // wiki link 菜单仍打开时（用户未取消），失焦即创建对应页面
      if (menuVisible.value) {
        const { state } = editor.value
        const cursorPos = state.selection.from
        const result = findWikiLinkAtCursor(state.doc, cursorPos)
        if (result.found && result.query.trim()) {
          const pageStore = usePageStore()
          if (!pageStore.getPageByTitle(result.query.trim())) {
            pageStore.createPage(result.query.trim())
          }
        }
        menuVisible.value = false
        closeWikiLinkMenuByEditor()
      }
      try {
        emit('save', editor.value.getText())
      } catch {
        // schema 可能在卸载阶段已为 null，跳过保存
      }
    }
  },
  onUpdate: () => {
    if (props.readonly) return
    if (editor.value && !settingContent) {
      hasContent.value = !!editor.value.getText()
      const { from } = editor.value.state.selection
      emit('cursor-change', from)
      const content = editor.value.getText()
      debouncedEmitSave(content)
    }
  }
}))

let settingContent = false

// 模板驱动的 wiki link 选择（保留为组件方法，由 PageLinkMenu @select 触发）
async function handleWikiLinkSelect(pageName: string) {
  if (!editor.value) return

  notifyWikiLinkMenuSelect()

  const { state } = editor.value
  const cursorPos = state.selection.from
  const result = findWikiLinkAtCursor(state.doc, cursorPos)
  const from = result.range?.from ?? cursorPos
  const to = result.range?.to ?? cursorPos

  editor.value.chain()
    .deleteRange({ from, to })
    .insertContent(`[[${pageName}]]`)
    .setTextSelection(from + pageName.length + 4)
    .focus()
    .run()

  menuVisible.value = false
  closeWikiLinkMenuByEditor()

  const pageStore = usePageStore()
  if (!pageStore.getPageByTitle(pageName)) {
    await pageStore.createPage(pageName)
  }
}

function handleKindSelect(kind: DateRefKind) {
  kindSelectorVisible.value = false
  const view = kindSelectorView.value
  if (!view) return
  const range = kindSelectorRange.value
  const coords = view.coordsAtPos(range.to)

  openDateRefPanel(
    {
      blockId: props.blockId || '',
      from: range.from,
      to: range.to,
      kind,
      iso: new Date().toISOString().slice(0, 10),
      recurrence: 'none',
      leadMinutes: 0,
      position: { x: coords.left, y: coords.bottom + 6 },
    },
    'editor'
  )
}

function handleKindSelectCancel() {
  kindSelectorVisible.value = false
}

// PageLinkMenu 的 @close 语义与 DOM 'wiki-link-close' 一致
function closeWikiLinkMenu() {
  menuVisible.value = false
  closeWikiLinkMenuByEditor()
}

// 把分散的 DOM CustomEvent handler 收敛进声明式事件表（./Block/editorEvents.ts），
// 由 useDomEvents 在挂载时统一注册、卸载时自动清理（不再手写镜像 add/remove）。
// 保留 DOM CustomEvent 传输通道（见 docs/adr/0016-editor-dom-event-transport.md）。
const events = createEditorEvents({
  // Vue 的 emit / openDateRefPanel 类型比 EditorEventCtx 严格（字面量事件名 / 窄 source 联合），
  // 在此边界处适配，工厂内部仍保持 (event:string,...args:unknown[]) 的安全签名。
  emit: emit as unknown as (event: string, ...args: unknown[]) => void,
  getEditor: () => editor.value,
  props: { blockId: props.blockId },
  menuVisible,
  menuPosition,
  menuRange,
  menuQuery,
  menuRef,
  kindSelectorVisible,
  kindSelectorPosition,
  kindSelectorRange,
  kindSelectorView,
  relMenu,
  openDateRefPanel: openDateRefPanel as unknown as (cfg: any, source: string) => void,
  closeWikiLinkMenuByEditor,
})
useDomEvents(() => editor.value?.view?.dom ?? null, () => events)

// 响应 readonly 变化
watch(
  () => props.readonly,
  (readonly) => {
    if (editor.value) {
      editor.value.setEditable(!readonly)
    }
  }
)

watch(
  () => props.content,
  (newContent) => {
    if (!editor.value) return
    if (editor.value.getText() !== newContent) {
      syncing = true
      settingContent = true
      editor.value.commands.setContent(textToHtml(newContent))
      settingContent = false
      syncing = false
    }
  }
)

onBeforeUnmount(() => {
  // 1. 取消 pending 的防抖保存，避免 destroy 后异步触发 emit('save')
  cancelDebouncedSave()
  // 2. 如果有未保存内容，立即同步保存
  if (editor.value && !savedFromOutside) {
    try {
      const text = editor.value.getText()
      if (text) {
        emit('save', text)
      }
    } catch {
      // schema 可能在卸载阶段已为 null，跳过保存
    }
  }
  // 3. 标记已保存，防止 destroy() 触发 onBlur 时保存空内容（Bug: 内容消失）
  savedFromOutside = true

  try {
    editor.value?.destroy()
  } catch (err) {
    console.warn('销毁编辑器失败:', err)
  }
})

function textToHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
}

function syncContent(content: string, cursorPos?: number) {
  if (editor.value) {
    const state = editor.value.state
    const prevSel = state.selection
    syncing = true
    editor.value.commands.setContent(content)
    syncing = false
    const targetPos = (cursorPos !== undefined)
      ? Math.min(cursorPos, content.length + 1)
      : prevSel.from
    editor.value.commands.setTextSelection(targetPos)
  }
}

function focus(pos?: number | 'start' | 'end') {
  if (editor.value) {
    if (typeof pos === 'number') {
      editor.value.commands.focus()
      editor.value.commands.setTextSelection(pos)
    } else {
      editor.value.commands.focus(pos)
    }
  }
}

function focusAtCoords(x: number, y: number) {
  if (!editor.value) return
  const view = editor.value.view

  // 标题补偿：编辑态文本含 "# " 前缀，渲染态不含，导致点击坐标在编辑态中偏前
  // 用 coordsAtPos 计算 # 前缀的 DOM 宽度，将 x 向右补偿
  const text = editor.value.state.doc.textContent
  const headingMatch = text.match(/^(#{1,6})\s+/)
  let adjustedX = x
  if (headingMatch) {
    const prefixEndPos = 1 + headingMatch[0].length // pos 1 = 首字符前
    const prefixEndCoords = view.coordsAtPos(prefixEndPos)
    const domRect = view.dom.getBoundingClientRect()
    const prefixWidth = prefixEndCoords.left - domRect.left
    adjustedX = x + prefixWidth
  }

  const pos = view.posAtCoords({ left: adjustedX, top: y })
  if (pos) {
    editor.value.commands.focus()
    editor.value.commands.setTextSelection(pos.pos)
  } else {
    focus('end')
  }
}

function markSaved() {
  savedFromOutside = true
}

function getEditor() {
  return editor.value
}

defineExpose({ syncContent, focus, focusAtCoords, getText: () => editor.value?.getText() ?? '', markSaved, getEditor, cancelDebouncedSave })
</script>

<template>
  <div class="editor-wrapper">
    <div v-if="showFullPlaceholder && !hasContent" class="editor-placeholder">写点什么…</div>
    <EditorContent :editor="editor" />
    <PageLinkMenu
      ref="menuRef"
      :visible="menuVisible"
      :position="menuPosition"
      :range="menuRange"
      :query="menuQuery"
      @select="handleWikiLinkSelect"
      @close="closeWikiLinkMenu"
    />
    <DateRefKindSelector
      :visible="kindSelectorVisible"
      :position="kindSelectorPosition"
      @select="handleKindSelect"
      @cancel="handleKindSelectCancel"
    />
  </div>
</template>

<style scoped>
.editor-wrapper {
  flex: 1;
  outline: none;
  position: relative;
  font-size: var(--editor-font-size);
}

.editor-placeholder {
  position: absolute;
  top: 2px;
  left: 4px;
  pointer-events: none;
  user-select: none;
  color: var(--text-tertiary);
  font-style: normal;
  opacity: 0.55;
}

.editor-wrapper :deep(.tiptap) {
  outline: none;
  min-height: 1.3em;
  line-height: var(--leading-snug);
  padding: 0 4px;
  white-space: pre-wrap;
  word-break: break-word;
}

.editor-wrapper :deep(.heading-preview) {
  font-weight: var(--font-semibold);
  line-height: var(--leading-snug);
  margin: 0;
  padding: 0;
  border: none;
  background: none;
}

.editor-wrapper :deep(.heading-preview-h1) {
  font-size: var(--heading-1);
  font-weight: var(--heading-1-weight);
}

.editor-wrapper :deep(.heading-preview-h2) {
  font-size: var(--heading-2);
  font-weight: var(--heading-2-weight);
}

.editor-wrapper :deep(.heading-preview-h3) {
  font-size: var(--heading-3);
  font-weight: var(--heading-3-weight);
}

.editor-wrapper :deep(.heading-preview-h4) {
  font-size: var(--heading-4);
  font-weight: var(--heading-4-weight);
}

.editor-wrapper :deep(.heading-preview-h5) {
  font-size: var(--heading-5);
  font-weight: var(--heading-5-weight);
  opacity: var(--heading-5-opacity);
}

.editor-wrapper :deep(.heading-preview-h6) {
  font-size: var(--heading-6);
  font-weight: var(--heading-6-weight);
  opacity: var(--heading-6-opacity);
}
</style>
