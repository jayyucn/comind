import { describe, it, expect, beforeEach, vi } from 'vitest'

import { useEditorSettings } from './useEditorSettings'

describe('useEditorSettings', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.style.removeProperty('--editor-font-size')
  })

  it('defaults to default when no stored preference', () => {
    const { editorFontSize } = useEditorSettings()
    expect(editorFontSize.value).toBe('default')
  })

  it('ignores invalid stored values and falls back to default', async () => {
    localStorage.setItem('comind-editor-font-size', 'giant')
    vi.resetModules()
    const { useEditorSettings: freshUseEditorSettings } = await import('./useEditorSettings')
    expect(freshUseEditorSettings().editorFontSize.value).toBe('default')
  })

  it('loads stored font size from localStorage', async () => {
    localStorage.setItem('comind-editor-font-size', 'large')
    vi.resetModules()
    const { useEditorSettings: freshUseEditorSettings } = await import('./useEditorSettings')
    expect(freshUseEditorSettings().editorFontSize.value).toBe('large')
  })

  it('setEditorFontSize updates value and localStorage', () => {
    const { editorFontSize, setEditorFontSize } = useEditorSettings()
    setEditorFontSize('x-large')
    expect(editorFontSize.value).toBe('x-large')
    expect(localStorage.getItem('comind-editor-font-size')).toBe('x-large')
  })

  it('setEditorFontSize applies --editor-font-size CSS variable to documentElement', () => {
    const { setEditorFontSize } = useEditorSettings()
    setEditorFontSize('small')
    expect(document.documentElement.style.getPropertyValue('--editor-font-size')).toBe('0.8125rem')
  })

  it('applies the CSS variable on module init for stored preference', async () => {
    localStorage.setItem('comind-editor-font-size', 'large')
    vi.resetModules()
    await import('./useEditorSettings')
    expect(document.documentElement.style.getPropertyValue('--editor-font-size')).toBe('1.0625rem')
  })
})
