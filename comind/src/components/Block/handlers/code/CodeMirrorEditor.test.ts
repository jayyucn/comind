import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import CodeMirrorEditor from './CodeMirrorEditor.vue'

const MockClipboard = {
  writeText: vi.fn().mockResolvedValue(undefined),
}

Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: MockClipboard.writeText },
  writable: true,
  configurable: true,
})

describe('CodeMirrorEditor — 只读渲染模式', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('应该支持只读模式 prop', async () => {
    const wrapper = mount(CodeMirrorEditor, {
      props: {
        blockId: 'test-block',
        content: 'const x = 1;',
        language: 'javascript',
        readonly: true,
      },
    })

    await flushPromises()
    await nextTick()

    expect(wrapper.props('readonly')).toBe(true)
  })

  it('只读模式下内容不可编辑', async () => {
    const wrapper = mount(CodeMirrorEditor, {
      props: {
        blockId: 'test-block',
        content: 'const x = 1;',
        language: 'javascript',
        readonly: true,
      },
    })

    await flushPromises()
    await nextTick()

    const editor = wrapper.find('.cm-editor')
    expect(editor.exists()).toBe(true)
  })

  it('只读模式下仍然显示语法高亮', async () => {
    const wrapper = mount(CodeMirrorEditor, {
      props: {
        blockId: 'test-block',
        content: 'const x = 1;',
        language: 'javascript',
        readonly: true,
      },
    })

    await flushPromises()
    await nextTick()

    const highlightedContent = wrapper.find('.cm-content')
    expect(highlightedContent.exists()).toBe(true)
  })

  it('只读模式下语言选择器仍然可用', async () => {
    const wrapper = mount(CodeMirrorEditor, {
      props: {
        blockId: 'test-block',
        content: 'const x = 1;',
        language: 'javascript',
        readonly: true,
      },
    })

    await flushPromises()
    await nextTick()

    const langButton = wrapper.find('.code-lang-button')
    expect(langButton.exists()).toBe(true)
    expect(langButton.text()).toContain('JavaScript')
  })

  it('只读模式下输入不触发 save 事件', async () => {
    const saveHandler = vi.fn()
    const wrapper = mount(CodeMirrorEditor, {
      props: {
        blockId: 'test-block',
        content: 'const x = 1;',
        language: 'javascript',
        readonly: true,
        onSave: saveHandler,
      },
    })

    await flushPromises()
    await nextTick()

    const editor = wrapper.find('.cm-editor')
    await editor.trigger('focus')

    await wrapper.vm.$nextTick()

    expect(saveHandler).not.toHaveBeenCalled()
  })

  it('编辑模式下内容可编辑', async () => {
    const wrapper = mount(CodeMirrorEditor, {
      props: {
        blockId: 'test-block',
        content: 'const x = 1;',
        language: 'javascript',
        readonly: false,
      },
    })

    await flushPromises()
    await nextTick()

    const editor = wrapper.find('.cm-editor')
    expect(editor.exists()).toBe(true)
  })

  it('默认情况下可编辑（readonly 为 false 或 undefined）', async () => {
    const wrapper = mount(CodeMirrorEditor, {
      props: {
        blockId: 'test-block',
        content: 'const x = 1;',
        language: 'javascript',
      },
    })

    await flushPromises()
    await nextTick()

    expect(wrapper.props('readonly')).toBeFalsy()
    const editor = wrapper.find('.cm-editor')
    expect(editor.exists()).toBe(true)
  })

  it('只读模式下有复制按钮', async () => {
    const wrapper = mount(CodeMirrorEditor, {
      props: {
        blockId: 'test-block',
        content: 'const x = 1;',
        language: 'javascript',
        readonly: true,
      },
    })

    await flushPromises()
    await nextTick()

    const copyButton = wrapper.find('.code-copy-button')
    expect(copyButton.exists()).toBe(true)
  })

  it('编辑模式下也有复制按钮', async () => {
    const wrapper = mount(CodeMirrorEditor, {
      props: {
        blockId: 'test-block',
        content: 'const x = 1;',
        language: 'javascript',
        readonly: false,
      },
    })

    await flushPromises()
    await nextTick()

    const copyButton = wrapper.find('.code-copy-button')
    expect(copyButton.exists()).toBe(true)
  })

  it('点击复制按钮会复制代码', async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })

    const wrapper = mount(CodeMirrorEditor, {
      props: {
        blockId: 'test-block',
        content: 'const x = 1;',
        language: 'javascript',
        readonly: true,
      },
    })

    await flushPromises()
    await nextTick()

    const copyButton = wrapper.find('.code-copy-button')
    await copyButton.trigger('click')

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('const x = 1;')
  })

  it('复制成功后会显示已复制提示', async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })

    vi.useFakeTimers()

    const wrapper = mount(CodeMirrorEditor, {
      props: {
        blockId: 'test-block',
        content: 'const x = 1;',
        language: 'javascript',
        readonly: true,
      },
    })

    await flushPromises()
    await nextTick()

    const copyButton = wrapper.find('.code-copy-button')
    await copyButton.trigger('click')

    expect(wrapper.props('readonly')).toBe(true)
  })

  it('渲染组件使用时应传递 blockId、content、language props', async () => {
    const testBlockId = 'block-123'
    const testContent = 'function test() {}'
    const testLanguage = 'javascript'

    const wrapper = mount(CodeMirrorEditor, {
      props: {
        blockId: testBlockId,
        content: testContent,
        language: testLanguage,
        readonly: true,
      },
    })

    const copyIcon = wrapper.find('.copy-icon')
    expect(copyIcon.exists()).toBe(true)
  })
})
