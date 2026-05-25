<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch, nextTick, shallowRef, ref } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { WikiLinkExtension } from '../extensions/WikiLinkExtension'
import { WikiLinkTriggerExtension, notifyWikiLinkMenuSelect } from '../extensions/WikiLinkTriggerExtension'
import EnterAsBlockExtension from '../extensions/EnterAsBlockExtension'
import BracketPairExtension from '../extensions/BracketPairExtension'
import { SlashCommandExtension } from '../extensions/SlashCommandExtension'
import { useNavigateToPage } from '../composables/useNavigateToPage'
import { debounce } from '../utils/debounce'
import PageLinkMenu from './PageLinkMenu.vue'

const props = defineProps<{
  blockId: string
  content: string
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

const { navigateToPage } = useNavigateToPage()

const debouncedEmitSave = debounce((content: string) => {
  emit('save', content)
}, 300)

const menuVisible = ref(false)
const menuPosition = ref({ x: 0, y: 0 })
const menuRange = ref({ from: 0, to: 0 })
const menuQuery = ref('')
const menuRef = ref<InstanceType<typeof PageLinkMenu> | null>(null)

function handleWikiLinkClick(event: Event) {
  const customEvent = event as CustomEvent<{ pageName: string }>
  navigateToPage(customEvent.detail.pageName)
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

function handleWikiLinkSelect(pageName: string) {
  if (!editor.value) return

  notifyWikiLinkMenuSelect()

  const state = editor.value.state
  const selection = state.selection
  const cursorPos = selection.from

  // 反向扫描找到 [[ 的起始位置
  let from = cursorPos - 1
  while (from >= 0) {
    if (from >= 1 && state.doc.textBetween(from - 1, from + 1) === '[[' ) {
      from = from - 1
      break
    }
    from--
  }
  if (from < 0) from = 0 // 兜底

  // 正向扫描找到可能的 ]]
  let to = cursorPos
  while (to < state.doc.content.size - 1) {
    if (state.doc.textBetween(to, to + 2) === ']]') {
      to = to + 2
      break
    }
    // 如果遇到空格或换行，可能表示链接结束
    const char = state.doc.textBetween(to, to + 1)
    if (char === ' ' || char === '\n' || char === '\r') {
      break
    }
    to++
  }
  if (to > state.doc.content.size) to = state.doc.content.size // 兜底

  editor.value.chain()
    .deleteRange({ from, to })
    .insertContent(`[[${pageName}]]`)
    .setTextSelection(from + pageName.length + 4)
    .focus()
    .run()

  menuVisible.value = false
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
    BracketPairExtension,
  ],
  content: textToHtml(props.content),
  autofocus: false,
  onBlur: () => {
    if (syncing) return
    if (savedFromOutside) {
      savedFromOutside = false
      return
    }
    if (editor.value) {
      emit('save', editor.value.getText())
    }
  },
  onUpdate: () => {
    if (editor.value) {
      const { from } = editor.value.state.selection
      emit('cursor-change', from)
      debouncedEmitSave(editor.value.getText())
    }
  }
}))

watch(
  () => props.content,
  (newContent) => {
    if (!editor.value) return
    if (editor.value.getText() !== newContent) {
      syncing = true
      editor.value.commands.setContent(textToHtml(newContent))
      syncing = false
    }
  }
)

onBeforeUnmount(() => {
  savedFromOutside = false
  
  try {
    const view = editor.value?.view
    if (view) {
      view.dom.removeEventListener('wiki-link-click', handleWikiLinkClick as EventListener)
      view.dom.removeEventListener('wiki-link-trigger', handleWikiLinkTrigger as EventListener)
      view.dom.removeEventListener('wiki-link-update', handleWikiLinkUpdate as EventListener)
      view.dom.removeEventListener('wiki-link-close', handleWikiLinkClose as EventListener)
      view.dom.removeEventListener('wiki-link-menu-enter', handleWikiLinkMenuEnter as EventListener)
      view.dom.removeEventListener('wiki-link-menu-escape', handleWikiLinkMenuEscape as EventListener)
      view.dom.removeEventListener('wiki-link-menu-arrowdown', handleWikiLinkMenuArrowDown as EventListener)
      view.dom.removeEventListener('wiki-link-menu-arrowup', handleWikiLinkMenuArrowUp as EventListener)
      view.dom.removeEventListener('enter-as-block', handleEnterAsBlock as EventListener)
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
  nextTick(() => {
    if (editor.value?.view) {
      editor.value.view.dom.addEventListener('wiki-link-click', handleWikiLinkClick as EventListener)
      editor.value.view.dom.addEventListener('wiki-link-trigger', handleWikiLinkTrigger as EventListener)
      editor.value.view.dom.addEventListener('wiki-link-update', handleWikiLinkUpdate as EventListener)
      editor.value.view.dom.addEventListener('wiki-link-close', handleWikiLinkClose as EventListener)
      editor.value.view.dom.addEventListener('wiki-link-menu-enter', handleWikiLinkMenuEnter as EventListener)
      editor.value.view.dom.addEventListener('wiki-link-menu-escape', handleWikiLinkMenuEscape as EventListener)
      editor.value.view.dom.addEventListener('wiki-link-menu-arrowdown', handleWikiLinkMenuArrowDown as EventListener)
      editor.value.view.dom.addEventListener('wiki-link-menu-arrowup', handleWikiLinkMenuArrowUp as EventListener)
      editor.value.view.dom.addEventListener('enter-as-block', handleEnterAsBlock as EventListener)
    }
  })
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

function markSaved() {
  savedFromOutside = true
}

function getEditor() {
  return editor.value
}

defineExpose({ syncContent, focus, getText: () => editor.value?.getText() ?? '', markSaved, getEditor })
</script>

<template>
  <div class="editor-wrapper">
    <EditorContent :editor="editor" />
    <PageLinkMenu
      ref="menuRef"
      :visible="menuVisible"
      :position="menuPosition"
      :range="menuRange"
      :query="menuQuery"
      @select="handleWikiLinkSelect"
      @close="handleWikiLinkClose"
    />
  </div>
</template>

<style scoped>
.editor-wrapper {
  flex: 1;
  outline: none;
}

.editor-wrapper :deep(.tiptap) {
  outline: none;
  min-height: 1.5em;
  padding: 0 4px;
}
</style>
