import type { Component } from 'vue'

export interface BlockTypeHandler {
  type: string
  label: string
  editorComponent: Component
  renderComponent: Component
}

export interface BlockTypeEditorExposed {
  syncContent: (content: string, cursorPos?: number) => void
  focus: (pos?: number | 'start' | 'end') => void
  getText: () => string
  markSaved: () => void
  getEditor: () => any
}

export interface BlockTypeRenderExposed {
  content: string
  showPlaceholder?: boolean
}