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
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { oneDark, oneDarkHighlightStyle } from '@codemirror/theme-one-dark'
import { useTheme } from '../../../../composables/useTheme'
import BasePopover from '../../../common/BasePopover.vue'

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
const menuPosition = ref({ x: 0, y: 0 })
const currentLang = ref(props.language || 'plain')
const showCopied = ref(false)
const { resolvedTheme } = useTheme()

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

const githubHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: '#cf222e' },
  { tag: tags.operator, color: '#cf222e' },
  { tag: tags.special(tags.variableName), color: '#24292e' },
  { tag: tags.typeName, color: '#6f42c1' },
  { tag: tags.atom, color: '#005cc5' },
  { tag: tags.number, color: '#005cc5' },
  { tag: tags.definition(tags.variableName), color: '#6f42c1' },
  { tag: tags.string, color: '#0a3069' },
  { tag: tags.special(tags.string), color: '#0a3069' },
  { tag: tags.comment, color: '#6a737d' },
  { tag: tags.variableName, color: '#24292e' },
  { tag: tags.tagName, color: '#22863a' },
  { tag: tags.bracket, color: '#24292e' },
  { tag: tags.meta, color: '#e36209' },
  { tag: tags.link, color: '#0a3069', textDecoration: 'underline' },
  { tag: tags.heading, fontWeight: 'bold', color: '#24292e' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.bool, color: '#005cc5' },
  { tag: tags.null, color: '#005cc5' },
  { tag: tags.className, color: '#6f42c1' },
  { tag: tags.propertyName, color: '#005cc5' },
  { tag: tags.function(tags.variableName), color: '#6f42c1' },
  { tag: tags.function(tags.propertyName), color: '#6f42c1' },
])

const githubTheme = EditorView.theme({
  '&': {
    fontSize: '14px',
    backgroundColor: '#f6f8fa',
    color: '#24292e',
    border: '1px solid #d0d7de',
    borderRadius: '6px',
  },
  '.cm-content': {
    fontFamily: "'SFMono-Regular', 'Consolas', 'Liberation Mono', 'Menlo', monospace",
    padding: '32px 12px 12px 12px',
    minHeight: '60px',
    caretColor: '#0969da',
  },
  '.cm-gutters': {
    backgroundColor: '#f6f8fa',
    color: '#6a737d',
    border: 'none',
    paddingRight: '8px',
    borderRight: '1px solid #d0d7de',
  },
  '.cm-activeLineGutter': {
    backgroundColor: '#eff1f3',
  },
  '.cm-activeLine': {
    backgroundColor: '#eff1f3',
  },
  '.cm-cursor': {
    borderLeftColor: '#0969da',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: '#b6d5f5',
  },
  '.cm-scroller': {
    overflow: 'auto',
  },
  '.cm-line': {
    padding: '0 4px',
  },
})

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
    resolvedTheme.value === 'dark' ? oneDark : githubTheme,
    resolvedTheme.value === 'dark' ? syntaxHighlighting(oneDarkHighlightStyle) : syntaxHighlighting(githubHighlightStyle),
    getLanguageExtension(currentLang.value),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !props.readonly) {
        emit('save', update.state.doc.toString())
      }
      if (update.selectionSet) {
        emit('cursor-change', update.state.selection.main.head)
      }
    }),
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

watch(resolvedTheme, () => {
  createEditor()
  nextTick(() => {
    view.value?.focus()
  })
})

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
      x: rect.left,
      y: rect.bottom + 4,
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
        <span class="dropdown-arrow">▾</span>
      </button>
      <BasePopover
        :visible="showLangMenu"
        :position="menuPosition"
        @close="showLangMenu = false"
      >
        <div class="lang-menu">
          <div
            v-for="lang in languages"
            :key="lang.id"
            :class="['lang-item', { active: lang.id === currentLang }]"
            @click="selectLanguage(lang.id)"
          >
            {{ lang.label }}
          </div>
        </div>
      </BasePopover>
    </div>
    <div class="code-copy-button-container">
      <button
        class="code-copy-button"
        @click.stop="copyCode"
        :title="showCopied ? 'Copied!' : 'Copy'"
      >
        <svg v-if="showCopied" class="copy-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
          <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/>
        </svg>
        <svg v-else class="copy-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
          <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/>
          <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/>
        </svg>
      </button>
    </div>
    <div ref="editorRef" class="code-editor-container"></div>
  </div>
</template>

<style scoped>
.code-editor-wrapper {
  position: relative;
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.code-lang-button-container {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: var(--z-sticky);
  opacity: 0;
  transition: opacity 0.2s;
}

.code-editor-wrapper:hover .code-lang-button-container {
  opacity: 1;
}

.code-copy-button-container {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: var(--z-sticky);
  opacity: 0;
  transition: opacity 0.2s;
}

.code-editor-wrapper:hover .code-copy-button-container {
  opacity: 1;
}

.code-lang-button {
  background: var(--bg-hover);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 3px 10px;
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: all 0.2s;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.04);
}

.code-copy-button {
  background: var(--bg-hover);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 6px;
  font-size: var(--text-xs);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.04);
}

.code-lang-button:hover, .code-copy-button:hover {
  background-color: var(--bg-active);
  border-color: var(--border-strong);
}

.dropdown-arrow {
  font-size: var(--text-xs);
  opacity: 0.7;
}

.copy-icon {
  width: 16px;
  height: 16px;
}

.code-editor-container {
  min-height: 60px;
}

.lang-menu {
  min-width: 140px;
  overflow: hidden;
}

.lang-item {
  padding: 8px 12px;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.2s;
}

.lang-item:hover {
  background: var(--bg-hover);
}

.lang-item.active {
  background: var(--accent-subtle);
  font-weight: var(--font-medium);
  color: var(--accent);
  border-left: 2px solid var(--accent);
  padding-left: 10px;
}
</style>
