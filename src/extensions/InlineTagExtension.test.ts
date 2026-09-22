import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { InlineTagExtension } from './InlineTagExtension'

interface DecoratedEditor {
  editor: Editor
  element: HTMLElement
  renderedHTML: string
}

function createDecoratedEditor(content: string): DecoratedEditor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({
    element,
    extensions: [Document, Paragraph, Text, InlineTagExtension],
    content: `<p>${content}</p>`,
  })
  return { editor, element, renderedHTML: element.innerHTML }
}

function destroyDecoratedEditor(handle: DecoratedEditor): void {
  handle.editor.destroy()
  handle.element.remove()
}

describe('InlineTagExtension — 编辑态 `#` 号装饰（图标位）', () => {
  it('`#tag` 的 `#` 被装饰为 tag-hash，tag 名不装饰', () => {
    const handle = createDecoratedEditor('这是 #标签')
    expect(handle.renderedHTML).toContain('tag-hash')
    // 装饰范围只有 `#` 一个字符
    expect(handle.renderedHTML).toContain('>#<')
    destroyDecoratedEditor(handle)
  })

  it('装饰不改变文档内容（`#` 仍是文本里的字符，光标/选区偏移不受影响）', () => {
    const handle = createDecoratedEditor('#标签 后面')
    expect(handle.element.textContent).toBe('#标签 后面')
    expect(handle.editor.getText()).toBe('#标签 后面')
    destroyDecoratedEditor(handle)
  })

  it('非 tag 文本不产生装饰', () => {
    const handle = createDecoratedEditor('纯文本 没有井号')
    expect(handle.renderedHTML).not.toContain('tag-hash')
    destroyDecoratedEditor(handle)
  })

  it('多个 tag 各自装饰', () => {
    const handle = createDecoratedEditor('#一 和 #二')
    const count = (handle.renderedHTML.match(/tag-hash/g) ?? []).length
    expect(count).toBe(2)
    destroyDecoratedEditor(handle)
  })
})
