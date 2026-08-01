import { ref, computed } from 'vue'

export type EditorFontSize = 'small' | 'default' | 'large' | 'x-large'

const STORAGE_KEY = 'comind-editor-font-size'

const FONT_SIZE_VALUES: Record<EditorFontSize, string> = {
  small: '0.8125rem',
  default: '0.9375rem',
  large: '1.0625rem',
  'x-large': '1.1875rem',
}

function isEditorFontSize(value: string | null): value is EditorFontSize {
  return value === 'small' || value === 'default' || value === 'large' || value === 'x-large'
}

function loadFontSize(): EditorFontSize {
  const stored = localStorage.getItem(STORAGE_KEY)
  return isEditorFontSize(stored) ? stored : 'default'
}

function applyFontSize(size: EditorFontSize) {
  document.documentElement.style.setProperty('--editor-font-size', FONT_SIZE_VALUES[size])
}

const editorFontSize = ref<EditorFontSize>(loadFontSize())

applyFontSize(editorFontSize.value)

export function useEditorSettings() {
  function setEditorFontSize(size: EditorFontSize) {
    editorFontSize.value = size
    localStorage.setItem(STORAGE_KEY, size)
    applyFontSize(size)
  }

  return {
    editorFontSize: computed(() => editorFontSize.value),
    setEditorFontSize,
  }
}
