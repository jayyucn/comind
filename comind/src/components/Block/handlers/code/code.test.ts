import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useBlockRegistry } from '../../../../composables/useBlockRegistry'

// Mock useTheme before importing the component
vi.mock('../../../../composables/useTheme', () => ({
  useTheme: vi.fn(() => ({
    theme: { value: 'light' },
    resolvedTheme: { value: 'light' },
  })),
}))

import CodeMirrorEditor from './CodeMirrorEditor.vue'

describe('Code Block — 类型注册与渲染', () => {
  const { register, getHandler, getRegisteredTypes } = useBlockRegistry()

  beforeEach(() => {
    const registry = (useBlockRegistry as any).registry
    if (registry instanceof Map) {
      const typesToRemove = [...registry.keys()].filter(t => t !== 'bullet')
      typesToRemove.forEach(t => registry.delete(t))
    }
  })

  it('code block 可以被注册到 registry', () => {
    register({
      type: 'code',
      label: 'Code',
      editorComponent: CodeMirrorEditor,
      renderComponent: CodeMirrorEditor
    })

    expect(getRegisteredTypes()).toContain('code')
  })

  it('getHandler(\'code\') 返回正确的 handler', () => {
    register({
      type: 'code',
      label: 'Code',
      editorComponent: CodeMirrorEditor,
      renderComponent: CodeMirrorEditor
    })

    const handler = getHandler('code')
    expect(handler).toBeDefined()
    expect(handler?.type).toBe('code')
    expect(handler?.label).toBe('Code')
    expect(handler?.editorComponent).toBe(CodeMirrorEditor)
    expect(handler?.renderComponent).toBe(CodeMirrorEditor)
  })

  it('未注册的类型返回 undefined', () => {
    const handler = getHandler('unknown')
    expect(handler).toBeUndefined()
  })

  it('code block 的编辑器组件应该支持标准接口', () => {
    register({
      type: 'code',
      label: 'Code',
      editorComponent: CodeMirrorEditor,
      renderComponent: CodeMirrorEditor
    })

    const handler = getHandler('code')
    expect(handler?.editorComponent).toBeDefined()
  })

  it('code block 的渲染组件应该是同一个组件', () => {
    register({
      type: 'code',
      label: 'Code',
      editorComponent: CodeMirrorEditor,
      renderComponent: CodeMirrorEditor
    })

    const handler = getHandler('code')
    expect(handler?.renderComponent).toBe(CodeMirrorEditor)
  })

  it('registry 支持覆盖已注册的类型', () => {
    const mockEditor1 = {} as any
    const mockRender1 = {} as any
    const mockEditor2 = {} as any
    const mockRender2 = {} as any

    register({
      type: 'code',
      label: 'Code 1',
      editorComponent: mockEditor1,
      renderComponent: mockRender1
    })

    register({
      type: 'code',
      label: 'Code 2',
      editorComponent: mockEditor2,
      renderComponent: mockRender2
    })

    const handler = getHandler('code')
    expect(handler?.label).toBe('Code 2')
    expect(handler?.editorComponent).toBe(mockEditor2)
    expect(handler?.renderComponent).toBe(mockRender2)
  })
})
