import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

import { useTheme } from './useTheme'

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it('defaults to system theme when no stored preference', () => {
    const { theme } = useTheme()
    expect(theme.value).toBe('system')
  })

  it('loads stored theme from localStorage', async () => {
    localStorage.setItem('comind-theme', 'dark')
    vi.resetModules()
    const { useTheme: freshUseTheme } = await import('./useTheme')
    const { theme } = freshUseTheme()
    expect(theme.value).toBe('dark')
  })

  it('setTheme updates theme and localStorage', () => {
    const { theme, setTheme } = useTheme()
    setTheme('dark')
    expect(theme.value).toBe('dark')
    expect(localStorage.getItem('comind-theme')).toBe('dark')
  })

  it('setTheme applies data-theme attribute to document', () => {
    const { setTheme } = useTheme()
    setTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('setTheme with light applies data-theme="light"', () => {
    const { setTheme } = useTheme()
    setTheme('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('setTheme with system resolves based on prefers-color-scheme', () => {
    const { setTheme } = useTheme()
    setTheme('system')
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    expect(document.documentElement.getAttribute('data-theme')).toBe(isDark ? 'dark' : 'light')
  })

  it('resolvedTheme reflects the actual applied theme', () => {
    const { resolvedTheme, setTheme } = useTheme()
    setTheme('dark')
    expect(resolvedTheme.value).toBe('dark')
    setTheme('light')
    expect(resolvedTheme.value).toBe('light')
  })
})
