<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch, shallowRef } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { Extension } from '@tiptap/core'
import { useEditorStore } from '../stores/editor'

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
}>()

const editorStore = useEditorStore()

// 跟踪用户是否正在输入（用于 watch 过滤）
let isUserEditing = false
let editingTimer: ReturnType<typeof setTimeout> | null = null

// 自定义扩展：在 ProseMirror keyboard shortcut 层拦截 Enter
// 返回 true 阻止 tiptap 默认段落行为，触发 split
const EnterAsBlockExtension = Extension.create({
  name: 'enterAsBlock',
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { from } = editor.state.selection
        emit('split', from)
        return true
      },
      // Shift+Enter：返回 false，放行给 tiptap 处理（软换行）
      'Shift-Enter': () => false,
      // Backspace：空 Block 时删除整个 Block（由父组件处理）
      Backspace: ({ editor }) => {
        const { from } = editor.state.selection
        const content = editor.getText()
        if (from === 0 && content.length === 0) {
          emit('delete')
          return true
        } else if (from === 0) {
          emit('merge')
          return true
        }
        return false
      },
      // Tab：缩进 / 取消缩进（由父组件处理）
      Tab: () => {
        emit('indent')
        return true
      },
      'Shift-Tab': () => {
        emit('outdent')
        return true
      },
    }
  }
})

const editor = shallowRef(useEditor({
  extensions: [
    StarterKit.configure({ heading: false, codeBlock: false, blockquote: false, horizontalRule: false }),
    EnterAsBlockExtension
  ],
  content: props.content,
  autofocus: true,
  onBlur: () => {
    if (editor.value) {
      emit('save', editor.value.getText())
    }
    editorStore.deactivateBlock()
  },
  onUpdate: () => {
    // 用户正在输入时，标记为编辑状态，阻止 watch 更新
    isUserEditing = true
    if (editingTimer) clearTimeout(editingTimer)
    editingTimer = setTimeout(() => {
      isUserEditing = false
    }, 100)
  }
}))

// 同步外部 content 变化
// isUserEditing 标志确保用户输入时不会被覆盖
watch(
  () => props.content,
  (newContent) => {
    if (!editor.value) return
    // 如果用户正在输入（100ms 内），跳过同步
    if (isUserEditing) return
    // 内容真的有差异时才更新
    if (editor.value.getText() !== newContent) {
      editor.value.commands.setContent(newContent)
    }
  }
)

onMounted(() => {
  editor.value?.commands.focus('end')
})

onBeforeUnmount(() => {
  if (editingTimer) clearTimeout(editingTimer)
  editor.value?.destroy()
})

// 暴露给父组件的同步方法（split 后强制同步内容）
function syncContent(content: string) {
  if (editor.value) {
    editor.value.commands.setContent(content)
  }
}

defineExpose({ syncContent })
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
