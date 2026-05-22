import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import xml from 'highlight.js/lib/languages/xml'
import { computed, type Ref, ref } from 'vue'

// Register languages once
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('go', go)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('json', json)
hljs.registerLanguage('html', xml)

export const languages = [
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

export function useCodeBlock(props: { content: string; language?: string }) {
  const currentLang = computed(() => {
    return props.language || 'plain'
  })

  const currentLangLabel = computed(() => {
    const lang = languages.find(l => l.id === currentLang.value)
    return lang?.label || 'Plain Text'
  })

  const highlightedContent = computed(() => {
    if (!props.content || currentLang.value === 'plain') {
      return escapeHtml(props.content)
    }
    try {
      const result = hljs.highlight(props.content, { language: currentLang.value })
      return result.value
    } catch {
      return escapeHtml(props.content)
    }
  })

  function escapeHtml(text: string): string {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  return {
    languages,
    currentLang,
    currentLangLabel,
    highlightedContent,
    escapeHtml,
  }
}

export function useLanguageMenu(buttonRef: Ref<HTMLButtonElement | null>) {
  const showLangMenu = ref(false)
  const menuPosition = ref({ top: 0, left: 0 })

  function updateMenuPosition() {
    if (buttonRef.value) {
      const rect = buttonRef.value.getBoundingClientRect()
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

  return {
    showLangMenu,
    menuPosition,
    updateMenuPosition,
    toggleMenu,
  }
}

export function useCopyButton() {
  const showCopied = ref(false)

  async function copyCode(content: string) {
    try {
      await navigator.clipboard.writeText(content)
      showCopied.value = true
      setTimeout(() => {
        showCopied.value = false
      }, 2000)
    } catch (err) {
      console.error('Failed to copy code:', err)
    }
  }

  return {
    showCopied,
    copyCode,
  }
}
