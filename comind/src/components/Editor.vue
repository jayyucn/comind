<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch, shallowRef, nextTick } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { WikiLinkExtension } from '../extensions/WikiLinkExtension'
import EnterAsBlockExtension from '../extensions/EnterAsBlockExtension'
import BracketPairExtension from '../extensions/BracketPairExtension'
import { useNavigateToPage } from '../composables/useNavigateToPage'

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
  (e: 'cursor-change', pos: number): void
}>()

let syncing = false
let savedFromOutside = false

const { navigateToPage } = useNavigateToPage()

function handleWikiLinkClick(event: Event) {
  const customEvent = event as CustomEvent<{ pageName: string }>
  navigateToPage(customEvent.detail.pageName)
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
  }
}

const editor = shallowRef(useEditor({
  extensions: [
    StarterKit.configure({ heading: false, codeBlock: false, blockquote: false, horizontalRule: false }),
    EnterAsBlockExtension,
    WikiLinkExtension,
    BracketPairExtension
  ],
  content: props.content,
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
    }
  }
}))

watch(
  () => props.content,
  (newContent) => {
    if (!editor.value) return
    if (editor.value.getText() !== newContent) {
      syncing = true
      editor.value.commands.setContent(newContent)
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

defineExpose({ syncContent, focus, getText: () => editor.value?.getText() ?? '', markSaved })
</script>

<template>
  <div class="editor-wrapper">
    <EditorContent :editor="editor" />
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
