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

// resolver 闭包读这张可变表，模拟宿主（Editor.vue）注入的 reactive 闭包
let tagTable: Record<string, { color: string; is_system: boolean }> = {}

function createDecoratedEditor(content: string): DecoratedEditor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({
    element,
    extensions: [
      Document,
      Paragraph,
      Text,
      InlineTagExtension.configure({
        resolve: (title) => tagTable[title],
      }),
    ],
    content: `<p>${content}</p>`,
  })
  return { editor, element, renderedHTML: element.innerHTML }
}

function destroyDecoratedEditor(handle: DecoratedEditor): void {
  handle.editor.destroy()
  handle.element.remove()
}

describe('InlineTagExtension — 编辑态 `#tag` 胶囊（与渲染态同形，ADR-0050 D11）', () => {
  it('`#tag` 整段装饰为 block-tag，tag 名取 resolver 给的色', () => {
    tagTable = { 标签: { color: '--tag-color-3', is_system: false } }
    const handle = createDecoratedEditor('这是 #标签')
    expect(handle.renderedHTML).toContain('block-tag')
    // jsdom 会把 style 属性归一化（`color:var(...)` → `color: var(...);`），用宽松匹配
    expect(handle.renderedHTML).toMatch(/style="[^"]*color:\s*var\(--tag-color-3\)/)
    expect(handle.renderedHTML).toContain('--tag-color-3')
    destroyDecoratedEditor(handle)
  })

  it('装饰不改变文档内容（`#` 按字面保留，光标/选区偏移不受影响）', () => {
    tagTable = {}
    const handle = createDecoratedEditor('#标签 后面')
    expect(handle.element.textContent).toBe('#标签 后面')
    expect(handle.editor.getText()).toBe('#标签 后面')
    destroyDecoratedEditor(handle)
  })

  it('查无此 tag：只有类名、无内联样式 —— 落回 .block-tag 的默认色', () => {
    tagTable = {}
    const handle = createDecoratedEditor('这是 #标签')
    expect(handle.renderedHTML).toContain('block-tag')
    expect(handle.renderedHTML).not.toContain('style=')
    destroyDecoratedEditor(handle)
  })

  it('系统 tag 带 block-tag--system 修饰类', () => {
    tagTable = { 任务: { color: '', is_system: true } }
    const handle = createDecoratedEditor('#任务')
    expect(handle.renderedHTML).toContain('block-tag--system')
    expect(handle.renderedHTML).not.toContain('style=')
    destroyDecoratedEditor(handle)
  })

  it('未白名单的色值不进 DOM（tagChipStyle 白名单收口）', () => {
    tagTable = { 标签: { color: 'red;}</style><img src=x onerror=alert(1)>', is_system: false } }
    const handle = createDecoratedEditor('#标签')
    expect(handle.renderedHTML).not.toContain('style=')
    expect(handle.renderedHTML).not.toContain('<img')
    destroyDecoratedEditor(handle)
  })

  it('非 tag 文本不产生装饰', () => {
    tagTable = {}
    const handle = createDecoratedEditor('纯文本 没有井号')
    expect(handle.renderedHTML).not.toContain('block-tag')
    destroyDecoratedEditor(handle)
  })

  it('多个 tag 各自装饰', () => {
    tagTable = {
      一: { color: '--tag-color-2', is_system: false },
      二: { color: '--tag-color-4', is_system: false },
    }
    const handle = createDecoratedEditor('#一 和 #二')
    const count = (handle.renderedHTML.match(/block-tag/g) ?? []).length
    expect(count).toBe(2)
    destroyDecoratedEditor(handle)
  })

  it('resolver 闭包更新后，空 transaction 触发装饰重算（宿主 watch 的接法）', () => {
    tagTable = {}
    const handle = createDecoratedEditor('这是 #标签')
    expect(handle.renderedHTML).not.toContain('style=')
    // 标签树异步到位：宿主改表后 dispatch 空 tr 逼一次 view update 重算装饰
    tagTable = { 标签: { color: '--tag-color-5', is_system: false } }
    handle.editor.view.dispatch(handle.editor.state.tr)
    expect(handle.element.innerHTML).toMatch(/color:\s*var\(--tag-color-5\)/)
    destroyDecoratedEditor(handle)
  })
})
