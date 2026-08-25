<script setup lang="ts">
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { css } from '@codemirror/lang-css'
import { go } from '@codemirror/lang-go'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { sql } from '@codemirror/lang-sql'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { oneDark, oneDarkHighlightStyle } from '@codemirror/theme-one-dark'
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useBlockRegistry } from '../../../../composables/useBlockRegistry'
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

/** 折叠（chevron 切换）：仅本地状态，刷新块即重置，符合代码块常见用法 */
const collapsed = ref(false)
/** 自动换行：仅本地状态，刷新块即重置 */
const wrap = ref(false)

// header 左侧的代码块类型标签，从 registry 取；fallback 是为了应付未注册等异常路径
const { getHandler } = useBlockRegistry()
const headerLabel = computed(() => getHandler('code')?.label ?? '代码块')

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
    padding: '12px 12px 12px 12px',
    minHeight: '60px',
    caretColor: '#0969da',
    backgroundColor: 'transparent',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-base)',
    color: '#6a737d',
    border: 'none',
    paddingLeft: '8px',
    paddingRight: '8px',
    borderRight: '1px solid #d0d7de',
  },
  '.cm-activeLineGutter': {
    // backgroundColor: '#eff1f3',
    backgroundColor: 'transparent',
  },
  '.cm-activeLine': {
    // backgroundColor: '#eff1f3',
    backgroundColor: 'transparent',

  },
  '.cm-cursor': {
    borderLeftColor: '#0969da',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    // backgroundColor: '#b6d5f5',
    backgroundColor: 'transparent',
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
    ...(wrap.value ? [EditorView.lineWrapping] : []),
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

/** wrap 切换：lineWrapping extension 不可热插拔，所以重建编辑器；
 *  注意 readonly 模式下没有 watch(readonly) 之后的 nextTick focus，但 wrap
 *  仅影响视觉，不应抢焦点，所以在 nextTick 里把焦点放回。 */
watch(wrap, () => {
  if (!editorRef.value) return
  const hadFocus = view.value?.hasFocus === true
  createEditor()
  if (hadFocus) {
    nextTick(() => view.value?.focus())
  }
})

/** chevron 展开时把焦点放回编辑器，让用户能继续在原位编辑 */
watch(collapsed, (isCollapsed) => {
  if (!isCollapsed) {
    nextTick(() => view.value?.focus())
  }
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

function markSaved() { }

function getEditor() {
  return view.value
}

defineExpose({ syncContent, focus, getText, markSaved, getEditor })
</script>

<template>
  <div class="code-editor-wrapper" :class="{ 'is-collapsed': collapsed }">
    <header class="code-header">
      <button type="button" class="code-toggle" :aria-expanded="!collapsed" aria-label="折叠代码块"
        @click.stop="collapsed = !collapsed">
        <span class="code-toggle-chevron" :class="{ 'is-collapsed': collapsed }">▾</span>
        <span class="code-toggle-label">{{ headerLabel }}</span>
      </button>
      <div class="code-toolbar">
        <button ref="langButtonRef" type="button" class="code-toolbar-btn" @click.stop="toggleMenu">
          <span>{{ currentLangLabel }}</span>
          <span class="code-toolbar-arrow">▾</span>
        </button>
        <span class="code-toolbar-divider" aria-hidden="true"></span>
        <button type="button" class="code-toolbar-btn" :class="{ active: wrap }" :aria-pressed="wrap"
          @click.stop="wrap = !wrap">
          自动换行
        </button>
        <span class="code-toolbar-divider" aria-hidden="true"></span>
        <button type="button" class="code-toolbar-btn" :title="showCopied ? '已复制' : '复制'" @click.stop="copyCode">
          <svg v-if="showCopied" class="copy-icon" viewBox="0 0 16 16" width="14" height="14" fill="currentColor"
            aria-hidden="true">
            <path
              d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
          </svg>
          <svg v-else class="copy-icon" viewBox="0 0 16 16" width="14" height="14" fill="currentColor"
            aria-hidden="true">
            <path
              d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z" />
            <path
              d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
          </svg>
          <span class="code-toolbar-text">复制</span>
        </button>
        <BasePopover :visible="showLangMenu" :position="menuPosition" @close="showLangMenu = false">
          <div class="lang-menu">
            <div v-for="lang in languages" :key="lang.id" :class="['lang-item', { active: lang.id === currentLang }]"
              @click="selectLanguage(lang.id)">
              {{ lang.label }}
            </div>
          </div>
        </BasePopover>
      </div>
    </header>
    <div v-show="!collapsed" class="code-editor-body">
      <div ref="editorRef" class="code-editor-container"></div>
    </div>
  </div>
</template>

<style scoped>
.code-editor-wrapper {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 6px);
  overflow: hidden;
  /* 头部透明（不设背景），仅正文代码区有底色 */
}

/* ── Header（透明，无底色）── */
.code-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2, 8px);
  padding: 4px 6px 4px 4px;
  background: transparent;
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.code-editor-wrapper:not(.is-collapsed) .code-header {
  border-bottom: 1px solid var(--border);
}

/* 左侧折叠按钮 */
.code-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1, 4px);
  padding: 2px 6px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  cursor: pointer;
  user-select: none;
}

.code-toggle:hover {
  background: var(--bg-active);
  color: var(--text-primary);
}

.code-toggle-chevron {
  display: inline-block;
  font-size: 10px;
  transition: transform 0.18s ease;
}

.code-toggle-chevron.is-collapsed {
  transform: rotate(-90deg);
}

/* 右侧工具栏：hover 才显示（与原来 hover 浮层一致）。
 * visibility 随 opacity 一起隐藏，否则 opacity:0 的按钮仍可 Tab 聚焦。 */
.code-toolbar {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1, 4px);
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.2s, visibility 0.2s;
}

.code-editor-wrapper:hover .code-toolbar {
  opacity: 1;
  visibility: visible;
}

.code-toolbar-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1, 4px);
  padding: 3px 8px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.code-toolbar-btn:hover {
  background: var(--bg-active);
  color: var(--text-primary);
}

.code-toolbar-btn.active {
  color: var(--accent);
  background: var(--accent-subtle);
}

.code-toolbar-btn.active:hover {
  background: var(--accent-bg);
  color: var(--accent-hover);
}

.code-toolbar-arrow {
  font-size: 9px;
  opacity: 0.7;
}

.code-toolbar-divider {
  width: 1px;
  height: 14px;
  background: var(--border);
  margin: 0 2px;
}

.code-toolbar-text {
  margin-left: 2px;
}

.copy-icon {
  width: 14px;
  height: 14px;
}

/* ── Editor body ── */
.code-editor-body {
  background: var(--bg-base);
}

/* 行号（num）区域：两个主题统一用 --bg-base（githubTheme 的 .cm-gutters 只在浅色生效，oneDark 自带背景需覆盖） */
.code-editor-body :deep(.cm-gutters) {
  background-color: var(--bg-base);
}

.code-editor-body :deep(.cm-activeLineGutter) {
  background: transparent;
}

.code-editor-body :deep(.cm-editor) {
  background: transparent;
}

.code-editor-container {
  min-height: 60px;
}

/* 代码内容左右边距：统一覆盖浅色/深色主题（githubTheme 与 oneDark 的 .cm-content padding 不一致） */
.code-editor-body :deep(.cm-editor .cm-content) {
  padding-right: var(--space-5, 20px);
}

/* 隐藏 .cm-editor 浏览器默认 focus outline（激活态会在 header 下边缘显示为异常虚线） */
.code-editor-body :deep(.cm-editor) {
  outline: none;
  border: none;
}

/* ── Language menu ── */
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
