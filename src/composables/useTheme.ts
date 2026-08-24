import { ref, computed } from 'vue'

export type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'comind-theme'

function loadTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  return 'system'
}

function resolve(t: Theme): 'light' | 'dark' {
  if (t !== 'system') return t
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(t: Theme) {
  const resolved = resolve(t)
  document.documentElement.setAttribute('data-theme', resolved)
  resolvedTheme.value = resolved
}

const theme = ref<Theme>(loadTheme())
const resolvedTheme = ref<'light' | 'dark'>(resolve(theme.value))

applyTheme(theme.value)

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (theme.value === 'system') applyTheme('system')
})

export function useTheme() {
  function setTheme(t: Theme) {
    theme.value = t
    localStorage.setItem(STORAGE_KEY, t)
    applyTheme(t)
  }

  return {
    theme: computed(() => theme.value),
    resolvedTheme: computed(() => resolvedTheme.value),
    setTheme,
  }
}
