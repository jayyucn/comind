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
  (e: 'cursor-change', pos: number): void
}>()

const editorStore = useEditorStore()

// 跟踪用户是否正在输入（用于 watch 过滤）
let isUserEditing = false
let editingTimer: ReturnType<typeof setTimeout> | null = null

// 同步内容期间禁用 onBlur 失活（防止 setContent 触发 onBlur）
let syncing = false
// 强制同步标志（用于 split/merge 等外部内容变更场景）
let forceSync = false

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
        const { $from } = editor.state.selection
        const content = editor.getText()
        if (content.length === 0) {
          emit('delete')
          return true
        } else if ($from.parentOffset === 0) {
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
  autofocus: false,
  onBlur: () => {
    if (syncing) return  // 同步期间不触发失活
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
    // 触发光标位置变化事件
    if (editor.value) {
      const { from } = editor.value.state.selection
      emit('cursor-change', from)
    }
  }
}))

// 同步外部 content 变化
// isUserEditing 标志确保用户输入时不会被覆盖
// forceSync 标志用于强制同步（如 split/merge 操作）
watch(
  () => props.content,
  (newContent) => {
    if (!editor.value) return
    if (isUserEditing && !forceSync) return
    if (editor.value.getText() !== newContent) {
      syncing = true
      editor.value.commands.setContent(newContent)
      syncing = false
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

// 暴露给父组件的同步方法（split/merge 后强制同步内容 + 恢复光标）
function syncContent(content: string, cursorPos?: number) {
  if (editor.value) {
    forceSync = true // 强制同步，忽略 isUserEditing
    const state = editor.value.state
    const prevSel = state.selection
    syncing = true
    editor.value.commands.setContent(content)
    syncing = false
    const targetPos = (cursorPos !== undefined)
      ? Math.min(cursorPos, content.length + 1)
      : prevSel.from
    editor.value.commands.setTextSelection(targetPos)
    forceSync = false
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

defineExpose({ syncContent, focus, getText: () => editor.value?.getText() ?? '' })
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
