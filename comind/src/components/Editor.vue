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

// 自定义扩展：在 tiptap 的 keyboard shortcut 层拦截 Enter
// 这样可以在 tiptap 内部修改状态之前先处理
const EnterAsBlockExtension = Extension.create({
  name: 'enterAsBlock',
  addKeyboardShortcuts() {
    return {
      // 拦截 Enter：返回 true 表示已处理，不再执行 tiptap 默认的段落换行
      Enter: ({ editor }) => {
        const { from } = editor.state.selection
        const content = editor.getText()
        const before = content.slice(0, from)
        // 立即将编辑器内容设为 before，防止 tiptap 插入换行
        editor.commands.setContent(before)
        // 触发 split 事件，父组件处理后的 after 内容会通过 watch 更新进来
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
  }
}))

// 同步外部 content 变化
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
