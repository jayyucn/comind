<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { useEditorStore } from '../stores/editor'

const props = defineProps<{
  blockId: string
  content: string
}>()

const emit = defineEmits<{
  (e: 'save', content: string): void
  (e: 'split', cursorPos: number): void
  (e: 'merge'): void
  (e: 'indent'): void
  (e: 'outdent'): void
}>()

const editorStore = useEditorStore()

const editor = useEditor({
  extensions: [
    StarterKit.configure({ heading: false, codeBlock: false, blockquote: false, horizontalRule: false }),
    Placeholder.configure({ placeholder: 'Type something...' })
  ],
  content: props.content,
  autofocus: true,
  onBlur: () => {
    if (editor.value) {
      emit('save', editor.value.getText())
    }
    editorStore.deactivateBlock()
  }
})

// 同步外部 content 变化（仅在非活跃时）
watch(
  () => props.content,
  (newContent) => {
    if (editor.value && editor.value.getText() !== newContent) {
      editor.value.commands.setContent(newContent)
    }
  }
)

onMounted(() => {
  editor.value?.commands.focus('end')
})

onBeforeUnmount(() => {
  editor.value?.destroy()
})

function handleKeyDown(e: KeyboardEvent) {
  if (!editor.value) return

  const { from } = editor.value.state.selection

  switch (e.key) {
    case 'Enter':
      if (!e.shiftKey) {
        e.preventDefault()
        emit('split', from)
      }
      break
    case 'Backspace':
      if (from === 0) {
        e.preventDefault()
        emit('merge')
      }
      break
    case 'Tab':
      e.preventDefault()
      if (e.shiftKey) {
        emit('outdent')
      } else {
        emit('indent')
      }
      break
  }
}
</script>

<template>
  <div class="editor-wrapper" @keydown="handleKeyDown">
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
}

.editor-wrapper :deep(.tiptap p.is-editor-empty:first-child::before) {
  color: #adb5bd;
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
}
</style>
