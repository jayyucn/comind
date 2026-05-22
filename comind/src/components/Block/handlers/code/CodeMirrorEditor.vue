<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, shallowRef, computed, nextTick } from 'vue'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { sql } from '@codemirror/lang-sql'
import { rust } from '@codemirror/lang-rust'
import { go } from '@codemirror/lang-go'
import { oneDark } from '@codemirror/theme-one-dark'

const props = withDefaults(defineProps<{
  blockId: string
  content: string
  language?: string
  readonly?: boolean
}>(), {
  readonly: false,
})

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

const editorRef = ref<HTMLDivElement | null>(null)
const view = shallowRef<EditorView | null>(null)
const langButtonRef = ref<HTMLButtonElement | null>(null)
const showLangMenu = ref(false)
const menuPosition = ref({ top: 0, left: 0 })
const currentLang = ref(props.language || 'plain')
const showCopied = ref(false)

const languages = [
  { id: 'plain', label: 'Plain Text' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'python', label: 'Python' },
  { id: 'go', label: 'Go' },
  { id: 'rust', label: 'Rust' },
  { id: 'sql', label: 'SQL' },
  { id: 'bash', label: 'Bash' },
  { id: 'json', label: 'JSON' },
  { id: 'html', label: 'HTML/CSS' },
]

const currentLangLabel = computed(() => {
  const lang = languages.find(l => l.id === currentLang.value)
  return lang?.label || 'Plain Text'
})

function getLanguageExtension(lang: string) {
  switch (lang) {
    case 'javascript':
    case 'typescript':
      return javascript({ typescript: lang === 'typescript' })
    case 'python':
      return python()
    case 'json':
      return json()
    case 'html':
    case 'html-css':
      return html()
    case 'css':
      return css()
    case 'sql':
      return sql()
    case 'rust':
      return rust()
    case 'go':
      return go()
    default:
      return []
  }
}

function createEditor() {
  if (!editorRef.value) return

  if (view.value) {
    view.value.destroy()
  }

  const extensions = [
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    history(),
    EditorView.editable.of(!props.readonly),
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab,
      {
        key: 'Mod-]',
        run: () => {
          if (!props.readonly) {
            emit('indent')
          }
          return true
        }
      },
      {
        key: 'Mod-[',
        run: () => {
          if (!props.readonly) {
            emit('outdent')
          }
          return true
        }
      },
      {
        key: 'Mod-ArrowUp',
        run: () => {
          if (!props.readonly) {
            emit('move-up')
          }
          return true
        }
      },
      {
        key: 'Mod-ArrowDown',
        run: () => {
          if (!props.readonly) {
            emit('move-down')
          }
          return true
        }
      },
      {
        key: 'Escape',
        run: () => {
          emit('exit-edit')
          return true
        }
      }
    ]),
    oneDark,
    getLanguageExtension(currentLang.value),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !props.readonly) {
        emit('save', update.state.doc.toString())
      }
      if (update.selectionSet) {
        emit('cursor-change', update.state.selection.main.head)
      }
    }),
    EditorView.theme({
      '&': {
        fontSize: '14px',
        backgroundColor: '#1e1e1e'
      },
      '.cm-content': {
        fontFamily: "'Fira Code', 'Monaco', 'Consolas', monospace",
        padding: '32px 12px 12px 12px',
        minHeight: '60px'
      },
      '.cm-gutters': {
        backgroundColor: '#1e1e1e',
        color: '#666',
        border: 'none',
        paddingRight: '8px'
      },
      '.cm-activeLineGutter': {
        backgroundColor: '#2a2a2a'
      },
      '.cm-activeLine': {
        backgroundColor: '#2a2a2a'
      },
      '.cm-scroller': {
        overflow: 'auto'
      }
    })
  ]

  const state = EditorState.create({
    doc: props.content,
    extensions
  })

  view.value = new EditorView({
    state,
    parent: editorRef.value
  })
}

async function copyCode() {
  try {
    await navigator.clipboard.writeText(props.content)
    showCopied.value = true
    setTimeout(() => {
      showCopied.value = false
    }, 2000)
  } catch (err) {
    console.error('Failed to copy code:', err)
  }
}

watch(
  () => props.content,
  (newContent) => {
    if (view.value && view.value.state.doc.toString() !== newContent) {
      view.value.dispatch({
        changes: {
          from: 0,
          to: view.value.state.doc.length,
          insert: newContent
        }
      })
    }
  }
)

watch(
  () => props.language,
  (newLang) => {
    if (newLang && newLang !== currentLang.value) {
      currentLang.value = newLang
      createEditor()
    }
  }
)

watch(currentLang, (newLang) => {
  if (view.value && newLang !== props.language) {
    emit('language-change', newLang)
  }
})

watch(
  () => props.readonly,
  () => {
    createEditor()
  }
)

onMounted(() => {
  createEditor()
  if (view.value) {
    view.value.focus()
  }
})

onBeforeUnmount(() => {
  if (view.value) {
    view.value.destroy()
  }
})

function selectLanguage(lang: string) {
  currentLang.value = lang
  showLangMenu.value = false
  createEditor()
  nextTick(() => {
    view.value?.focus()
  })
}

function updateMenuPosition() {
  if (langButtonRef.value) {
    const rect = langButtonRef.value.getBoundingClientRect()
    menuPosition.value = {
      top: rect.bottom + window.scrollY,
      left: rect.left + window.scrollX
    }
  }
}

function toggleMenu() {
  showLangMenu.value = !showLangMenu.value
  if (showLangMenu.value) {
    updateMenuPosition()
  }
}

function syncContent(content: string, pos?: number) {
  if (view.value) {
    view.value.dispatch({
      changes: {
        from: 0,
        to: view.value.state.doc.length,
        insert: content
      }
    })
    if (pos !== undefined) {
      view.value.dispatch({
        selection: { anchor: pos }
      })
    }
  }
}

function focus(pos?: number | 'start' | 'end') {
  if (view.value) {
    view.value.focus()
    if (typeof pos === 'number') {
      view.value.dispatch({
        selection: { anchor: pos }
      })
    } else if (pos === 'start') {
      view.value.dispatch({
        selection: { anchor: 0 }
      })
    } else if (pos === 'end') {
      view.value.dispatch({
        selection: { anchor: view.value.state.doc.length }
      })
    }
  }
}

function getText() {
  return view.value?.state.doc.toString() ?? ''
}

function markSaved() {}

function getEditor() {
  return view.value
}

defineExpose({ syncContent, focus, getText, markSaved, getEditor })
</script>

<template>
  <div class="code-editor-wrapper">
    <div class="code-lang-button-container">
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
    <div class="code-copy-button-container">
      <button
        class="code-copy-button"
        @click.stop="copyCode"
        :title="showCopied ? 'Copied!' : 'Copy code'"
      >
        <span v-if="showCopied" class="copy-icon">✓</span>
        <span v-else class="copy-icon">📋</span>
      </button>
    </div>
    <div ref="editorRef" class="code-editor-container"></div>
  </div>
</template>

<style scoped>
.code-editor-wrapper {
  position: relative;
  background: #1e1e1e;
  border-radius: 4px;
  overflow: hidden;
}

.code-lang-button-container {
  position: absolute;
  top: 4px;
  left: 4px;
  z-index: 10;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.code-editor-wrapper:hover .code-lang-button-container {
  opacity: 1;
}

.code-copy-button-container {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 10;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.code-editor-wrapper:hover .code-copy-button-container {
  opacity: 1;
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

.code-copy-button {
  background: #333;
  color: #d4d4d4;
  border: 1px solid #555;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  min-width: 32px;
}

.code-lang-button:hover, .code-copy-button:hover {
  background: #444;
  border-color: #666;
}

.dropdown-arrow {
  font-size: 10px;
  opacity: 0.7;
}

.copy-icon {
  font-size: 14px;
}

.code-editor-container {
  min-height: 60px;
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

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
