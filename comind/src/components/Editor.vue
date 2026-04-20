<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch, shallowRef, ref } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { Extension } from '@tiptap/core'

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

// 同步内容期间禁用 onBlur 保存（防止 setContent 触发 onBlur 写回旧内容）
let syncing = false
// 标记已由外部（split/merge）保存，阻止 onBlur 重复保存（ref 确保组件实例隔离）
// 使用 ref 确保每个 Editor 组件实例有独立的状态，避免多个实例共享同一变量导致状态冲突
const savedFromOutside = ref(false)

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
    if (syncing) return  // 同步期间不触发保存
    if (savedFromOutside.value) {
      savedFromOutside.value = false
      return  // 外部已保存，跳过
    }
    if (editor.value) {
      emit('save', editor.value.getText())
    }
    // 注意：不在这里调用 deactivateBlock()
    // 失活由 Block.vue 显式控制（handleSplit/handleMerge/handleDelete 等）
  },
  onUpdate: () => {
    // 触发光标位置变化事件
    if (editor.value) {
      const { from } = editor.value.state.selection
      emit('cursor-change', from)
    }
  }
}))

// 同步外部 content 变化（仅当编辑器文本与 prop 不一致时才更新）
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

onMounted(() => {
    editor.value?.commands.focus('end')
})

onBeforeUnmount(() => {
  savedFromOutside.value = false  // 清理状态，防止泄漏
  editor.value?.destroy()
})

// 暴露给父组件的同步方法（split/merge 后强制同步内容 + 恢复光标）
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

// 暴露给父组件：标记内容已由外部保存，阻止 onBlur 重复保存
function markSaved() {
  savedFromOutside.value = true
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
