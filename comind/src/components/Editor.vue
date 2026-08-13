<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch, shallowRef, ref } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { TextSelection } from '@tiptap/pm/state'
import { WikiLinkExtension } from '../extensions/WikiLinkExtension'
import { WikiLinkTriggerExtension, notifyWikiLinkMenuSelect, closeWikiLinkMenuByEditor, findWikiLinkAtCursor } from '../extensions/WikiLinkTriggerExtension'
import { RelationshipTriggerExtension, notifyRelationshipMenuSelect, closeRelationshipMenuByEditor } from '../extensions/RelationshipTriggerExtension'
import EnterAsBlockExtension from '../extensions/EnterAsBlockExtension'
import BracketPairExtension from '../extensions/BracketPairExtension'
import { SlashCommandExtension } from '../extensions/SlashCommandExtension'
import { HeadingPreviewExtension } from '../extensions/HeadingPreviewExtension'
import { DateRefExtension, DATE_REF_CLICK_EVENT, type DateRefClickPayload } from '../extensions/DateRefExtension'
import { DateRefTriggerExtension, type DateRefKindSelectEvent } from '../extensions/DateRefTriggerExtension'
import { usePageStore } from '../stores/pages'
import { useDateTimePickerPanel } from '../composables/useDateTimePickerPanel'
import { useRelationshipMenu } from '../composables/useRelationshipMenu'
import { getRelationshipLabel } from '../types/relationship'
import { debounce } from '../utils/debounce'
import PageLinkMenu from './PageLinkMenu.vue'
import DateRefKindSelector from './DateRefKindSelector.vue'
import type { DateRefKind } from '../utils/date-ref'

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

function handleRelationshipTrigger(event: Event) {
  const customEvent = event as CustomEvent<{
    view: any
    position: number
    range: { from: number; to: number }
    relationshipType: string
  }>
  const { view, position, range } = customEvent.detail
  const coords = view.coordsAtPos(position)

  relMenu.open({
    view,
    position: { x: coords.left, y: coords.bottom + 6 },
    range,
    initialQuery: '',
    onSelect: (newType) => {
      if (!editor.value) return
      const { state, view: edView } = editor.value
      const tr = state.tr

      // 检查光标后面是否有自动补全的 ))
      const docSize = state.doc.content.size
      let endPos = range.to
      if (endPos + 2 <= docSize) {
        const afterText = state.doc.textBetween(endPos, endPos + 2)
        if (afterText === '))' || afterText === '））') {
          endPos += 2
        }
      }

      // 替换从 range.from 到 endPos 的内容为 ((label))（编辑态显示中文；保存时 encode 转回 type）
      const label = getRelationshipLabel(newType)
      tr.insertText(`((${label}))`, range.from, endPos)

      // 设置光标到末尾
      const newCursorPos = range.from + label.length + 4 // (( + label + ))
      tr.setSelection(TextSelection.create(tr.doc, newCursorPos))

      edView.dispatch(tr)
      notifyRelationshipMenuSelect()
      closeRelationshipMenuByEditor()
    }
  })
}

function handleRelationshipClose(_event: Event) {
  // 扩展在 '(( ' 模式被破坏时（Backspace / 输入字符 / 转义）
  // 派发此事件，关闭关系菜单 UI。
  relMenu.close()
}

function handleDateRefTrigger(event: Event) {
  const customEvent = event as CustomEvent<{
    view: any
    position: number
    range: { from: number; to: number }
    kind: 'schedule' | 'deadline'
  }>
  const { view, position, range, kind } = customEvent.detail
  const coords = view.coordsAtPos(position)

  // PM 节点不携带 blockId，需借助 .block[data-block-id] 包裹层从 DOM 解析
  let blockId: string | null = null
  try {
    const domAt = view.domAtPos(position)
    let domEl: any = domAt.node
    if (domEl && domEl.nodeType === 3) domEl = domEl.parentElement
    const blockEl = domEl?.closest?.('[data-block-id]') as HTMLElement | null
    blockId = blockEl?.dataset?.blockId ?? null
  } catch {
    blockId = null
  }

  const { open: openDateRefPanel } = useDateTimePickerPanel()
  openDateRefPanel(
    {
      blockId: blockId || '',
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

function handleDateRefClick(event: Event) {
  const customEvent = event as CustomEvent<DateRefClickPayload>
  const { from, to, kind, iso, recurrence, leadMinutes } = customEvent.detail

  const target = event.target as HTMLElement
  const rect = target.getBoundingClientRect()

  const { open: openDateRefPanel } = useDateTimePickerPanel()
  openDateRefPanel(
    {
      blockId: props.blockId || '',
      from,
      to,
      kind,
      iso,
      recurrence,
      leadMinutes,
      position: { x: rect.left, y: rect.bottom + 6 },
    },
    'editor'
  )
}

function handleDateRefKindSelect(event: Event) {
  const customEvent = event as CustomEvent<DateRefKindSelectEvent>
  const { view, range, coords } = customEvent.detail
  kindSelectorView.value = view
  kindSelectorRange.value = range
  kindSelectorPosition.value = { left: coords.left, top: coords.top, bottom: coords.bottom }
  kindSelectorVisible.value = true
}

function handleKindSelect(kind: DateRefKind) {
  kindSelectorVisible.value = false
  const view = kindSelectorView.value
  if (!view) return
  const range = kindSelectorRange.value
  const coords = view.coordsAtPos(range.to)

  const { open: openDateRefPanel } = useDateTimePickerPanel()
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

function handleWikiLinkTrigger(event: Event) {
  const customEvent = event as CustomEvent<{
    view: any
    position: number
    range: { from: number; to: number }
    query: string
  }>

  const { view, position, range, query } = customEvent.detail
  const coords = view.coordsAtPos(position)

  menuPosition.value = { x: coords.left, y: coords.bottom + 8 }
  menuRange.value = range
  menuQuery.value = query
  menuVisible.value = true
}

function handleWikiLinkUpdate(event: Event) {
  const customEvent = event as CustomEvent<{
    query: string
  }>

  menuQuery.value = customEvent.detail.query
}

function handleWikiLinkClose() {
  menuVisible.value = false
  closeWikiLinkMenuByEditor()
}

function handleWikiLinkMenuEnter() {
  menuRef.value?.confirmSelect()
}

function handleWikiLinkMenuEscape() {
  menuRef.value?.close()
}

function handleWikiLinkMenuArrowDown() {
  menuRef.value?.selectNext()
}

function handleWikiLinkMenuArrowUp() {
  menuRef.value?.selectPrev()
}

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

function handleEnterAsBlock(event: Event) {
  const customEvent = event as CustomEvent<{ type: string; pos?: number }>
  switch (customEvent.detail.type) {
    case 'split':
      emit('split', customEvent.detail.pos ?? 0)
      break
    case 'delete':
      emit('delete')
      break
    case 'merge':
      emit('merge')
      break
    case 'indent':
      emit('indent')
      break
    case 'outdent':
      emit('outdent')
      break
    case 'moveUp':
      emit('moveUp')
      break
    case 'moveDown':
      emit('moveDown')
      break
    case 'exitEdit':
      emit('exitEdit')
      break
    case 'save':
      if (editor.value) {
        emit('save', editor.value.getText())
      }
      break
  }
}

function textToHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
}

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
    const view = editor.value?.view
    if (view) {
      view.dom.removeEventListener('wiki-link-trigger', handleWikiLinkTrigger as EventListener)
      view.dom.removeEventListener('wiki-link-update', handleWikiLinkUpdate as EventListener)
      view.dom.removeEventListener('wiki-link-close', handleWikiLinkClose as EventListener)
      view.dom.removeEventListener('wiki-link-menu-enter', handleWikiLinkMenuEnter as EventListener)
      view.dom.removeEventListener('wiki-link-menu-escape', handleWikiLinkMenuEscape as EventListener)
      view.dom.removeEventListener('wiki-link-menu-arrowdown', handleWikiLinkMenuArrowDown as EventListener)
      view.dom.removeEventListener('wiki-link-menu-arrowup', handleWikiLinkMenuArrowUp as EventListener)
      view.dom.removeEventListener('enter-as-block', handleEnterAsBlock as EventListener)
      view.dom.removeEventListener('relationship-trigger', handleRelationshipTrigger as EventListener)
      view.dom.removeEventListener('relationship-close', handleRelationshipClose as EventListener)
      view.dom.removeEventListener('dateRefTrigger', handleDateRefTrigger as EventListener)
      view.dom.removeEventListener(DATE_REF_CLICK_EVENT, handleDateRefClick as EventListener)
      view.dom.removeEventListener('dateRefKindSelect', handleDateRefKindSelect as EventListener)
      view.dom.removeEventListener('dateRefKindSelectClose', (() => { kindSelectorVisible.value = false }) as EventListener)
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('editor view is not available')) {
      return
    }
    console.warn('移除事件监听器失败:', err)
  }
  try {
    editor.value?.destroy()
  } catch (err) {
    console.warn('销毁编辑器失败:', err)
  }
})

onMounted(() => {
  // 同步注册事件监听器（不使用 nextTick），防止 Editor 刚挂载时 Enter 等事件无人处理（Bug: Enter 无法换行）
  if (editor.value?.view) {
    editor.value.view.dom.addEventListener('wiki-link-trigger', handleWikiLinkTrigger as EventListener)
    editor.value.view.dom.addEventListener('wiki-link-update', handleWikiLinkUpdate as EventListener)
    editor.value.view.dom.addEventListener('wiki-link-close', handleWikiLinkClose as EventListener)
    editor.value.view.dom.addEventListener('wiki-link-menu-enter', handleWikiLinkMenuEnter as EventListener)
    editor.value.view.dom.addEventListener('wiki-link-menu-escape', handleWikiLinkMenuEscape as EventListener)
    editor.value.view.dom.addEventListener('wiki-link-menu-arrowdown', handleWikiLinkMenuArrowDown as EventListener)
    editor.value.view.dom.addEventListener('wiki-link-menu-arrowup', handleWikiLinkMenuArrowUp as EventListener)
    editor.value.view.dom.addEventListener('enter-as-block', handleEnterAsBlock as EventListener)
    editor.value.view.dom.addEventListener('relationship-trigger', handleRelationshipTrigger as EventListener)
    editor.value.view.dom.addEventListener('relationship-close', handleRelationshipClose as EventListener)
    editor.value.view.dom.addEventListener('dateRefTrigger', handleDateRefTrigger as EventListener)
    editor.value.view.dom.addEventListener(DATE_REF_CLICK_EVENT, handleDateRefClick as EventListener)
    editor.value.view.dom.addEventListener('dateRefKindSelect', handleDateRefKindSelect as EventListener)
    editor.value.view.dom.addEventListener('dateRefKindSelectClose', (() => { kindSelectorVisible.value = false }) as EventListener)
  }
})

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
      @close="handleWikiLinkClose as any"
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
