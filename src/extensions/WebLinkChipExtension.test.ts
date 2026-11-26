import { Editor } from '@tiptap/core'
import Code from '@tiptap/extension-code'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import type { EditorView } from '@tiptap/pm/view'

import {
  scanWebLinkChipsInDoc,
  WebLinkChipExtension,
} from './WebLinkChipExtension'

function createEditor(text: string, code = false): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  return new Editor({
    element,
    extensions: [Document, Paragraph, Text, Code, WebLinkChipExtension],
    content: {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: text
          ? [{ type: 'text', text, ...(code ? { marks: [{ type: 'code' }] } : {}) }]
          : [],
      }],
    },
  })
}

function withEditor<T>(text: string, run: (editor: Editor) => T, code = false): T {
  const editor = createEditor(text, code)
  const element = editor.view.dom.parentElement
  try {
    return run(editor)
  } finally {
    editor.destroy()
    element?.remove()
  }
}

function keydown(editor: Editor, key: string, pos: number) {
  const plugin = editor.state.plugins.find(p => p.key.startsWith('webLinkChip'))
  expect(plugin, 'webLinkChip 插件未挂载').toBeDefined()
  const handler = plugin!.spec.props.handleKeyDown as
    | ((view: EditorView, event: KeyboardEvent) => boolean)
    | undefined
  expect(handler).toBeTypeOf('function')
  editor.commands.setTextSelection(pos)
  return handler!(editor.view, { key, preventDefault: vi.fn() } as unknown as KeyboardEvent)
}

function textInput(editor: Editor, from: number, to: number, text: string) {
  const plugin = editor.state.plugins.find(p => p.key.startsWith('webLinkChip'))
  const handler = plugin!.spec.props.handleTextInput as
    | ((view: EditorView, from: number, to: number, text: string) => boolean)
    | undefined
  expect(handler).toBeTypeOf('function')
  return handler!(editor.view, from, to, text)
}

describe('WebLinkChipExtension — 编辑态只露别名（ADR-0067）', () => {
  it('语法字符零宽隐藏，屏幕只剩别名；文档字面一个字都不改', () => {
    withEditor('看 [飞书](https://a.com) 吧', (editor) => {
      const chip = editor.view.dom.querySelector('.web-link-chip:not(.pm-prefix-hidden)') as HTMLElement | null
      expect(chip?.textContent).toBe('飞书')
      expect(chip?.dataset.chipUrl).toBe('https://a.com')
      expect(chip?.dataset.chipTitle).toBe('飞书')
      const hidden = editor.view.dom.querySelectorAll('.pm-prefix-hidden')
      expect(Array.from(hidden).map(el => el.textContent).join('')).toBe('[](https://a.com)')
      expect(Array.from(hidden).every(el => el.getAttribute('contenteditable') === 'false')).toBe(true)
      expect(editor.getText()).toBe('看 [飞书](https://a.com) 吧')
    })
  })

  it('链接视图的可见文字就是 URL，隐藏区仍是整段语法', () => {
    withEditor('[https://a.com](https://a.com)', (editor) => {
      const chip = editor.view.dom.querySelector('.web-link-chip:not(.pm-prefix-hidden)') as HTMLElement | null
      expect(chip?.textContent).toBe('https://a.com')
      expect(scanWebLinkChipsInDoc(editor.state.doc)).toHaveLength(1)
    })
  })

  it('行内代码里的 markdown 外链不装饰', () => {
    withEditor('[飞书](https://a.com)', (editor) => {
      expect(editor.view.dom.querySelector('.web-link-chip')).toBeNull()
      expect(editor.getText()).toBe('[飞书](https://a.com)')
    }, true)
  })
})

describe('WebLinkChipExtension — 最小键盘护栏', () => {
  it('Delete 在别名末尾跳过隐藏 URL，删 chip 右边第一个可见字', () => {
    withEditor('前[飞书](https://a.com)后', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      expect(keydown(editor, 'Delete', chip.titleTo)).toBe(true)
      expect(editor.getText()).toBe('前[飞书](https://a.com)')
    })
  })

  it('Backspace 在别名起点跳过隐藏的 `[`，删 chip 之前那个可见字', () => {
    withEditor('前[飞书](https://a.com)后', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      expect(keydown(editor, 'Backspace', chip.titleFrom)).toBe(true)
      expect(editor.getText()).toBe('[飞书](https://a.com)后')
    })
  })

  it('方向键跨过隐藏区：→ 从 `[` 前落到别名起点', () => {
    withEditor('[飞书](https://a.com)', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      expect(keydown(editor, 'ArrowRight', chip.from)).toBe(true)
      expect(editor.state.selection.from).toBe(chip.titleFrom)
    })
  })

  it('别名最后一个字被退格：整段 chip 消失，正文留空', () => {
    withEditor('[a](https://a.com)', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      expect(keydown(editor, 'Backspace', chip.titleTo)).toBe(true)
      expect(editor.getText()).toBe('')
    })
  })
})

describe('WebLinkChipExtension — 链接视图改写语义', () => {
  it('直接打字同步改别名和 URL，两截保持相同', () => {
    withEditor('[https://a.com](https://a.com)', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      expect(textInput(editor, chip.titleTo, chip.titleTo, 'x')).toBe(true)
      expect(editor.getText()).toBe('[https://a.comx](https://a.comx)')
    })
  })

  it('改成不合法网址就拆掉隐藏 URL，只留用户输入的文字', () => {
    withEditor('[https://a.com](https://a.com)', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      expect(textInput(editor, chip.titleTo, chip.titleTo, ' ')).toBe(true)
      expect(editor.getText()).toBe('https://a.com ')
      expect(editor.view.dom.querySelector('.web-link-chip')).toBeNull()
    })
  })
})
