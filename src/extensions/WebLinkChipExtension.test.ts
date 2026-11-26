import { Editor } from '@tiptap/core'
import Code from '@tiptap/extension-code'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { TextSelection } from '@tiptap/pm/state'
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

/** 不重置选区：用来测「选中一段再按 Backspace/Delete」这类路径 */
function keydownAtSelection(editor: Editor, key: string) {
  const plugin = editor.state.plugins.find(p => p.key.startsWith('webLinkChip'))
  const handler = plugin!.spec.props.handleKeyDown as
    | ((view: EditorView, event: KeyboardEvent) => boolean)
    | undefined
  expect(handler).toBeTypeOf('function')
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

/** 触发插件登记的 DOM 事件钩子（IME 合成开/关） */
function domEvent(editor: Editor, type: 'compositionstart' | 'compositionend') {
  const plugin = editor.state.plugins.find(p => p.key.startsWith('webLinkChip'))
  const handlers = plugin!.spec.props.handleDOMEvents as
    | Record<string, (view: EditorView, event: Event) => boolean>
    | undefined
  const handler = handlers?.[type]
  expect(handler, `handleDOMEvents.${type} 未挂载`).toBeTypeOf('function')
  return handler!(editor.view, new Event(type))
}

/**
 * 逐字键入：handler 未拦截时由这里插入（等价 ProseMirror 默认路径）。
 * 光标若被护栏算错一位，后续字符就会插到字面外面——只断言最终文本发现不了。
 */
function typeText(editor: Editor, input: string) {
  for (const ch of input) {
    const pos = editor.state.selection.from
    if (!textInput(editor, pos, pos, ch)) {
      const tr = editor.state.tr.insertText(ch, pos)
      tr.setSelection(TextSelection.create(tr.doc, pos + 1))
      editor.view.dispatch(tr)
    }
  }
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

  it('End / Home 落在可见行首行尾，不进隐藏的 `[](url)`', () => {
    withEditor('[https://a.com](https://a.com)', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      expect(keydown(editor, 'End', chip.from)).toBe(true)
      // 块尾是 chip：可见行尾 = 别名末尾（chip.to 在 contenteditable=false 里，浏览器存不住）
      expect(editor.state.selection.from).toBe(chip.titleTo)
      expect(keydown(editor, 'Home', chip.titleTo)).toBe(true)
      expect(editor.state.selection.from).toBe(chip.titleFrom)
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
      // 改的是别名中段（不是末尾），视为真的在改网址 ⇒ 拆掉链接
      expect(textInput(editor, chip.titleFrom + 1, chip.titleFrom + 1, '中')).toBe(true)
      expect(editor.getText()).toBe('h中ttps://a.com')
      expect(editor.view.dom.querySelector('.web-link-chip')).toBeNull()
    })
  })

  it('链接末尾打空格 / 标点：链接保留，字符落到右侧', () => {
    withEditor('[https://a.com](https://a.com)', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      expect(textInput(editor, chip.titleTo, chip.titleTo, '，')).toBe(true)
      expect(editor.getText()).toBe('[https://a.com](https://a.com)，')
      expect(scanWebLinkChipsInDoc(editor.state.doc)).toHaveLength(1)
    })
  })

  it('链接视图退格删末字符：两截同步，不会退化成标题视图 + 旧地址', () => {
    withEditor('[https://www.doubao.com](https://www.doubao.com)', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      expect(keydown(editor, 'Backspace', chip.titleTo)).toBe(true)
      expect(editor.getText()).toBe('[https://www.doubao.co](https://www.doubao.co)')
      const next = scanWebLinkChipsInDoc(editor.state.doc)
      expect(next).toHaveLength(1)
      expect(next[0]).toMatchObject({ title: 'https://www.doubao.co', url: 'https://www.doubao.co' })
      // 光标留在别名末尾，继续打字/退格都不会跳进隐藏区
      expect(editor.state.selection.from).toBe(next[0].titleTo)
    })
  })

  it('链接视图退格删中间字符：URL 跟着一起改', () => {
    withEditor('[https://a.com](https://a.com)', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      // 光标在 `.` 之后：退格删掉点号，`https://acom` 仍是合法网址
      expect(keydown(editor, 'Backspace', chip.titleFrom + 10)).toBe(true)
      expect(editor.getText()).toBe('[https://acom](https://acom)')
    })
  })

  it('链接视图 Delete 删首字符：删到不像网址就整段拆成文字', () => {
    withEditor('[https://a.com](https://a.com)', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      expect(keydown(editor, 'Delete', chip.titleFrom)).toBe(true)
      expect(editor.getText()).toBe('ttps://a.com')
      expect(editor.view.dom.querySelector('.web-link-chip')).toBeNull()
    })
  })

  it('链接视图退格到不再像网址：拆掉隐藏 URL，只留剩下的文字', () => {
    withEditor('[https://a](https://a)', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      expect(keydown(editor, 'Backspace', chip.titleTo)).toBe(true)
      expect(editor.getText()).toBe('https://')
      expect(editor.view.dom.querySelector('.web-link-chip')).toBeNull()
    })
  })

  it('链接视图选中一段删除：两截同步', () => {
    withEditor('[https://a.com](https://a.com)', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      // 选中别名里的 `a.`：剩 `https://com`，仍是合法网址
      editor.commands.setTextSelection({ from: chip.titleFrom + 8, to: chip.titleFrom + 10 })
      expect(keydownAtSelection(editor, 'Backspace')).toBe(true)
      expect(editor.getText()).toBe('[https://com](https://com)')
    })
  })

  it('标题视图退格交给默认路径：只改别名，URL 保持不动', () => {
    withEditor('[飞书](https://a.com)', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      // 返回 false = 放行 ProseMirror 默认删除（只掉别名一个字，隐藏 URL 不受影响）
      expect(keydown(editor, 'Backspace', chip.titleTo)).toBe(false)
      editor.commands.deleteRange({ from: chip.titleTo - 1, to: chip.titleTo })
      expect(editor.getText()).toBe('[飞](https://a.com)')
      expect(scanWebLinkChipsInDoc(editor.state.doc)[0]).toMatchObject({ title: '飞', url: 'https://a.com' })
    })
  })
})

describe('WebLinkChipExtension — 块尾 chip 之后接着写正文', () => {
  it('标题视图 + 块尾 chip：别名末尾打的字落到字面之后，标题不变', () => {
    withEditor('[飞书](https://a.com)', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      expect(textInput(editor, chip.titleTo, chip.titleTo, '尾')).toBe(true)
      expect(editor.getText()).toBe('[飞书](https://a.com)尾')
      expect(scanWebLinkChipsInDoc(editor.state.doc)[0]).toMatchObject({
        title: '飞书',
        url: 'https://a.com',
      })
      // 光标留在正文末尾，继续打字不会又跑回别名里
      expect(editor.state.selection.from).toBe(chip.to + 1)
    })
  })

  it('标题视图 + 块尾 chip：空格与中文标点同样落到字面之后', () => {
    withEditor('[飞书](https://a.com)', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      expect(textInput(editor, chip.titleTo, chip.titleTo, '，')).toBe(true)
      expect(editor.getText()).toBe('[飞书](https://a.com)，')
    })
  })

  it('标题视图 + chip 之后还有文字：别名末尾仍按默认改别名', () => {
    withEditor('[飞书](https://a.com)后', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      // 返回 false = 放行 ProseMirror 默认插入（落在别名末尾）
      expect(textInput(editor, chip.titleTo, chip.titleTo, '尾')).toBe(false)
      const tr = editor.state.tr.insertText('尾', chip.titleTo)
      editor.view.dispatch(tr)
      expect(editor.getText()).toBe('[飞书尾](https://a.com)后')
    })
  })

  it('标题视图 + 块尾 chip：合成提交后把增长的那截搬回正文', async () => {
    const editor = createEditor('[飞书](https://a.com)')
    try {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      editor.commands.setTextSelection(chip.titleTo)
      domEvent(editor, 'compositionstart')
      // ProseMirror 边合成边同步：预编辑文本直接落进别名，不经过 handleTextInput
      editor.view.dispatch(editor.state.tr.insertText('尾', chip.titleTo))
      expect(editor.getText()).toBe('[飞书尾](https://a.com)')
      domEvent(editor, 'compositionend')
      // 收尾排在 ProseMirror 自己的 flush 之后
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(editor.getText()).toBe('[飞书](https://a.com)尾')
      const next = scanWebLinkChipsInDoc(editor.state.doc)[0]
      expect(next).toMatchObject({ title: '飞书' })
      await new Promise(resolve => setTimeout(resolve, 20))
    } finally {
      const element = editor.view.dom.parentElement
      editor.destroy()
      element?.remove()
    }
  })

  it('合成中间态不搬：合成中落进别名的字留着等提交覆盖', () => {
    withEditor('[飞书](https://a.com)', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      editor.commands.setTextSelection(chip.titleTo)
      domEvent(editor, 'compositionstart')
      // 拼音中间态：还在合成里，不能当成正文搬出去
      editor.view.dispatch(editor.state.tr.insertText('wei', chip.titleTo))
      expect(editor.getText()).toBe('[飞书wei](https://a.com)')
    })
  })

  it('光标不在块尾别名末尾时，改别名不受 appendTransaction 干扰', () => {
    withEditor('[飞书](https://a.com)', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      // 光标在块首（不是 chip 末尾）：这次插入是真在改标题
      editor.commands.setTextSelection(chip.titleFrom + 1)
      editor.view.dispatch(editor.state.tr.insertText('书', chip.titleFrom + 1))
      expect(editor.getText()).toBe('[飞书书](https://a.com)')
    })
  })
})

describe('WebLinkChipExtension — 键入裸网址即成 chip', () => {
  it('整块键入网址：补上最后一字符就包成链接视图字面', () => {
    withEditor('https://a.co', (editor) => {
      const end = editor.state.doc.content.size - 1
      expect(textInput(editor, end, end, 'm')).toBe(true)
      expect(editor.getText()).toBe('[https://a.com](https://a.com)')
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      expect(chip.title).toBe('https://a.com')
      expect(chip.url).toBe('https://a.com')
    })
  })

  it('句中键入网址：只包网址那一段，前后文字不动', () => {
    withEditor('明天看 https://a.c', (editor) => {
      const end = editor.state.doc.content.size - 1
      expect(textInput(editor, end, end, 'o')).toBe(true)
      expect(editor.getText()).toBe('明天看 [https://a.co](https://a.co)')
    })
  })

  it('已经成 chip 之后再补字符，不会重复包裹', () => {
    withEditor('[https://a.com](https://a.com)', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      // 光标在字面之外（chip 右侧）：不归 chip 分支，也没有裸网址可包
      expect(textInput(editor, chip.to, chip.to, 'x')).toBe(false)
      expect(editor.getText()).toBe('[https://a.com](https://a.com)')
    })
  })

  it('半截网址不成 chip：只打到 `https://` 还不包裹', () => {
    withEditor('https:/', (editor) => {
      const end = editor.state.doc.content.size - 1
      // 返回 false = 放行 ProseMirror 默认插入，文档由它去写
      expect(textInput(editor, end, end, '/')).toBe(false)
      expect(editor.getText()).toBe('https:/')
    })
  })

  it('逐字键入整段网址：每个后续字符都续在别名末尾，不跑到字面外面', () => {
    withEditor('', (editor) => {
      typeText(editor, 'https://www.doubao.com')
      expect(editor.getText()).toBe('[https://www.doubao.com](https://www.doubao.com)')
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      expect(chip).toMatchObject({ title: 'https://www.doubao.com', url: 'https://www.doubao.com' })
      // 光标停在别名末尾（不是别名之后、也不是隐藏区里）
      expect(editor.state.selection.from).toBe(chip.titleTo)
    })
  })

  it('逐字键入后接着打中文标点：链接保留，标点落右侧', () => {
    withEditor('', (editor) => {
      typeText(editor, 'https://a.com')
      typeText(editor, '，然后')
      expect(editor.getText()).toBe('[https://a.com](https://a.com)，然后')
      expect(scanWebLinkChipsInDoc(editor.state.doc)).toHaveLength(1)
    })
  })
})
