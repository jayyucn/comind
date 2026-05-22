<script setup lang="ts">
import { ref, watch, onMounted, nextTick } from 'vue'
import { useCodeBlock, useLanguageMenu } from './useCodeBlock'

const props = defineProps<{
  blockId: string
  content: string
  language?: string
}>()

const emit = defineEmits<{
  (e: 'save', content: string): void
  (e: 'split', cursorPos: number): void
  (e: 'merge'): void
  (e: 'delete'): void
  (e: 'indent'): void
  (e: 'outdent'): void
  (e: 'move-up'): void
  (e: 'move-down'): void
  (e: 'exit-edit'): void
  (e: 'cursor-change', pos: number): void
  (e: 'language-change', lang: string): void
}>()

const textareaRef = ref<HTMLTextAreaElement | null>(null)
const langButtonRef = ref<HTMLButtonElement | null>(null)
const cursorPos = ref(0)
const currentLang = ref('plain')

const { languages, highlightedContent, currentLangLabel } = useCodeBlock({
  content: props.content,
  language: props.language,
})

const { showLangMenu, menuPosition, toggleMenu } = useLanguageMenu(langButtonRef)

watch(
  () => props.language,
  (newLang) => {
    if (newLang && languages.some(l => l.id === newLang)) {
      currentLang.value = newLang
    }
  },
  { immediate: true }
)

watch(
  () => props.content,
  (newContent) => {
    if (textareaRef.value && textareaRef.value.value !== newContent) {
      textareaRef.value.value = newContent
    }
  }
)

onMounted(async () => {
  await nextTick()
  if (textareaRef.value) {
    textareaRef.value.focus()
    textareaRef.value.setSelectionRange(cursorPos.value, cursorPos.value)
  }
})

function selectLanguage(lang: string) {
  currentLang.value = lang
  showLangMenu.value = false
  emit('language-change', lang)
  nextTick(() => {
    textareaRef.value?.focus()
  })
}

function handleInput(e: Event) {
  const target = e.target as HTMLTextAreaElement
  emit('save', target.value)
  emit('cursor-change', target.selectionStart)
}

function handleKeyDown(e: KeyboardEvent) {
  const target = e.target as HTMLTextAreaElement
  
  if (e.key === 'Tab') {
    e.preventDefault()
    const start = target.selectionStart
    const end = target.selectionEnd
    const value = target.value
    target.value = value.substring(0, start) + '  ' + value.substring(end)
    target.selectionStart = target.selectionEnd = start + 2
    emit('save', target.value)
  } else if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    const lineStart = target.value.lastIndexOf('\n', target.selectionStart - 1) + 1
    const line = target.value.substring(lineStart, target.selectionStart)
    const leadingSpaces = line.match(/^ */)?.[0] || ''
    const start = target.selectionStart
    const end = target.selectionEnd
    target.value = target.value.substring(0, start) + '\n' + leadingSpaces + target.value.substring(end)
    target.selectionStart = target.selectionEnd = start + 1 + leadingSpaces.length
    emit('save', target.value)
  } else if (e.key === 'Backspace' && target.value === '' && !e.shiftKey) {
    e.preventDefault()
    emit('delete')
  } else if (e.key === 'Backspace' && e.shiftKey) {
    e.preventDefault()
    emit('merge')
  } else if (e.key === 'ArrowUp' && e.ctrlKey) {
    e.preventDefault()
    emit('move-up')
  } else if (e.key === 'ArrowDown' && e.ctrlKey) {
    e.preventDefault()
    emit('move-down')
  } else if (e.key === ']' && e.ctrlKey) {
    e.preventDefault()
    emit('indent')
  } else if (e.key === '[' && e.ctrlKey) {
    e.preventDefault()
    emit('outdent')
  } else if (e.key === 'Escape') {
    emit('exit-edit')
  }
}

function syncContent(content: string, pos?: number) {
  if (textareaRef.value) {
    textareaRef.value.value = content
    if (pos !== undefined) {
      textareaRef.value.setSelectionRange(pos, pos)
    }
  }
}

function focus(pos?: number | 'start' | 'end') {
  if (textareaRef.value) {
    textareaRef.value.focus()
    if (pos === 'start') {
      textareaRef.value.setSelectionRange(0, 0)
    } else if (pos === 'end') {
      textareaRef.value.setSelectionRange(textareaRef.value.value.length, textareaRef.value.value.length)
    } else if (typeof pos === 'number') {
      textareaRef.value.setSelectionRange(pos, pos)
    }
  }
}

function getText() {
  return textareaRef.value?.value ?? ''
}

function markSaved() {
}

function getEditor() {
  return textareaRef.value
}

defineExpose({ syncContent, focus, getText, markSaved, getEditor })
</script>

<template>
  <div class="code-editor-wrapper">
    <div class="code-editor-header">
      <button
        ref="langButtonRef"
        class="code-lang-button"
        @click.stop="toggleMenu"
      >
        {{ currentLangLabel }}
        <span class="dropdown-arrow">▼</span>
      </button>
      <Teleport to="body">
        <Transition name="fade">
          <div
            v-if="showLangMenu"
            class="lang-menu"
            :style="{ top: menuPosition.top + 'px', left: menuPosition.left + 'px' }"
            @click.stop
          >
            <div
              v-for="lang in languages"
              :key="lang.id"
              :class="['lang-item', { active: lang.id === currentLang }]"
              @click="selectLanguage(lang.id)"
            >
              {{ lang.label }}
            </div>
          </div>
        </Transition>
      </Teleport>
    </div>
    <div class="code-content-container">
      <pre class="syntax-highlight" v-html="highlightedContent"></pre>
      <textarea
        ref="textareaRef"
        :value="content"
        @input="handleInput"
        @keydown="handleKeyDown"
        class="code-editor"
        spellcheck="false"
      />
    </div>
  </div>
</template>

<style scoped>
.code-editor-wrapper {
  position: relative;
  background: #1e1e1e;
  border-radius: 4px;
  overflow: hidden;
}

.code-editor-header {
  position: absolute;
  top: 4px;
  left: 4px;
  z-index: 10;
}

.code-lang-button {
  background: #333;
  color: #d4d4d4;
  border: 1px solid #555;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: all 0.15s ease;
}

.code-lang-button:hover {
  background: #444;
  border-color: #666;
}

.dropdown-arrow {
  font-size: 10px;
  opacity: 0.7;
}

.lang-menu {
  position: fixed;
  background: #2d2d2d;
  border: 1px solid #555;
  border-radius: 4px;
  margin-top: 4px;
  min-width: 150px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  z-index: 1000;
  overflow: hidden;
}

.lang-item {
  padding: 8px 12px;
  font-size: 13px;
  color: #d4d4d4;
  cursor: pointer;
  transition: background 0.1s ease;
}

.lang-item:hover {
  background: #3a3a3a;
}

.lang-item.active {
  background: #3d3d3d;
  border-left: 2px solid #569cd6;
  padding-left: 10px;
}

.code-content-container {
  position: relative;
  padding: 32px 12px 12px 12px;
  min-height: 60px;
}

.syntax-highlight {
  position: absolute;
  top: 32px;
  left: 12px;
  right: 12px;
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: 'Fira Code', 'Monaco', 'Consolas', monospace;
  font-size: 14px;
  line-height: 1.5;
  color: #d4d4d4;
  pointer-events: none;
  background: transparent;
  overflow: hidden;
}

.syntax-highlight :deep(.hljs-keyword) {
  color: #569cd6;
}

.syntax-highlight :deep(.hljs-string) {
  color: #ce9178;
}

.syntax-highlight :deep(.hljs-number) {
  color: #b5cea8;
}

.syntax-highlight :deep(.hljs-function) {
  color: #dcdcaa;
}

.syntax-highlight :deep(.hljs-comment) {
  color: #6a9955;
  font-style: italic;
}

.syntax-highlight :deep(.hljs-variable) {
  color: #9cdcfe;
}

.syntax-highlight :deep(.hljs-type) {
  color: #4ec9b0;
}

.syntax-highlight :deep(.hljs-attr) {
  color: #9cdcfe;
}

.syntax-highlight :deep(.hljs-literal) {
  color: #b5cea8;
}

.code-editor {
  position: relative;
  font-family: 'Fira Code', 'Monaco', 'Consolas', monospace;
  font-size: 14px;
  line-height: 1.5;
  padding: 0;
  background: transparent;
  color: transparent;
  caret-color: #d4d4d4;
  border: none;
  outline: none;
  resize: none;
  width: 100%;
  min-height: 24px;
  box-sizing: border-box;
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow-y: hidden;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
