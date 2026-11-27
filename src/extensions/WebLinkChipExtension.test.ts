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
function keydownAtSelection(editor: Editor, key: string) {  const plugin = editor.state.plugins.find(p => p.key.startsWith('webLinkChip'))
  const handler = plugin!.spec.props.handleKeyDown as
    | ((view: EditorView, event: KeyboardEvent) => boolean)
    | undefined
  expect(handler).toBeTypeOf('function')
  return handler!(editor.view, { key, preventDefault: vi.fn() } as unknown as KeyboardEvent)
}

/**
 * 按一次方向键：插件放行时补上浏览器的默认移动（插入符前后一格）。
 * 真实按键里「没被拦截」就等于移动一格，只看 handler 的返回值测不出视觉位移。
 */
function pressArrow(editor: Editor, key: 'ArrowLeft' | 'ArrowRight', pos: number) {
  const handled = keydown(editor, key, pos)
  if (handled) return handled
  // 插件可能先在 handleKeyDown 开头把落点收出了隐藏区，默认移动要基于那之后的位置
  const at = editor.state.selection.from
  editor.commands.setTextSelection(at + (key === 'ArrowRight' ? 1 : -1))
  return handled
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
      // 两截隐藏语法都**可编辑**（靠零宽 CSS 隐藏）：不可编辑的零宽 inline 之后
      // Chromium 摆不出插入符，别名第一个字前永远落不住。落进隐藏区的编辑由
      // handleKeyDown / handleTextInput 的位置守卫接住。
      expect(Array.from(hidden).every(el => el.getAttribute('contenteditable') === null)).toBe(true)
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

describe('WebLinkChipExtension — chip 之后的插入符位', () => {
  it('标题视图：光标停在 chip.to 按退格，删的是别名最后一个字，隐藏 URL 不动', () => {
    withEditor('[飞书](https://a.com)', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      expect(keydown(editor, 'Backspace', chip.to)).toBe(true)
      expect(editor.getText()).toBe('[飞](https://a.com)')
      const next = scanWebLinkChipsInDoc(editor.state.doc)[0]
      expect(next).toMatchObject({ title: '飞', url: 'https://a.com' })
      // 光标留在「链接之后」那一格（字面缩了一个字，chip.to 跟着左移）
      expect(editor.state.selection.from).toBe(next.to)
    })
  })

  it('链接视图：光标停在 chip.to 按退格，两截一起改，字面不会缺个 `)`', () => {
    withEditor('[https://a.com](https://a.com)', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      expect(keydown(editor, 'Backspace', chip.to)).toBe(true)
      expect(editor.getText()).toBe('[https://a.co](https://a.co)')
      expect(scanWebLinkChipsInDoc(editor.state.doc)).toHaveLength(1)
    })
  })

  it('光标落进隐藏尾巴内部时打字：写到字面之后，网址一个字不改', () => {
    withEditor('[https://a.com](https://a.com)', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      const insideTail = chip.titleTo + 2
      expect(textInput(editor, insideTail, insideTail, '尾')).toBe(true)
      expect(editor.getText()).toBe('[https://a.com](https://a.com)尾')
      expect(scanWebLinkChipsInDoc(editor.state.doc)[0]).toMatchObject({
        title: 'https://a.com',
        url: 'https://a.com',
      })
    })
  })

  it('光标停在 chip.to（链接之后）打字：字落在字面之后，不去改网址', () => {
    withEditor('[https://a.com](https://a.com)后', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      // 放行 ProseMirror 默认插入（chip.to 是真实位置）
      expect(textInput(editor, chip.to, chip.to, 'Z')).toBe(false)
      const tr = editor.state.tr.insertText('Z', chip.to)
      editor.view.dispatch(tr)
      expect(editor.getText()).toBe('[https://a.com](https://a.com)Z后')
    })
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

  it('Backspace 在前缀格 / 别名起点：交回默认路径，不吞按键', () => {
    withEditor('前[飞书](https://a.com)后', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      // 前缀格与别名顶到同一像素：都当作「字面之前」，让默认退格删链接前那个字
      expect(keydown(editor, 'Backspace', chip.from)).toBe(false)
      expect(keydown(editor, 'Backspace', chip.titleFrom)).toBe(false)
      expect(editor.getText()).toBe('前[飞书](https://a.com)后')
    })
  })

  it('块首 chip 上按退格不再被吞：交回默认路径（可走与上一块合并）', () => {
    withEditor('[飞书](https://a.com)', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      // 老实现这里 return true 吞掉整次按键 ⇒ 用户看到「按退格没反应」
      expect(keydown(editor, 'Backspace', chip.titleFrom)).toBe(false)
      expect(editor.getText()).toBe('[飞书](https://a.com)')
    })
  })

  it('方向键按视觉格走：零宽前缀只算一格，不在上面停两次', () => {
    withEditor('前[飞书](https://a.com)后', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      // chip.from 与 titleFrom 同像素（`[` advance 0）：落在 chip.from 按右，
      // 插入符要前进一个字，而不是先挪到同像素的 titleFrom（那就是「按两次才动」）
      pressArrow(editor, 'ArrowRight', chip.from)
      expect(editor.state.selection.from).toBe(chip.titleFrom + 1)
      // 反向：从 alias 首字前按左一次跨过整个前缀格，落到链接前那个字之后
      pressArrow(editor, 'ArrowLeft', chip.titleFrom)
      expect(editor.state.selection.from).toBe(chip.from - 1)
    })
  })

  it('→ 从别名末尾一次跨到链接之后：不在零宽隐藏尾巴上停一格', () => {
    withEditor('前[飞书](https://a.com)后', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      // titleTo 与 chip.to 视觉同格（中间只隔零宽尾巴），逐个跨会「按一次没动静」
      expect(keydown(editor, 'ArrowRight', chip.titleTo)).toBe(true)
      expect(editor.state.selection.from).toBe(chip.to + 1)
    })
  })

  it('→ 已停在链接之后按右键，同样只前进一格', () => {
    withEditor('前[飞书](https://a.com)后', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      expect(keydown(editor, 'ArrowRight', chip.to)).toBe(true)
      expect(editor.state.selection.from).toBe(chip.to + 1)
    })
  })

  it('→ 块尾 chip：别名末尾就是可见行尾，按右键不动', () => {
    withEditor('[飞书](https://a.com)', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      expect(keydown(editor, 'ArrowRight', chip.titleTo)).toBe(true)
      expect(editor.state.selection.from).toBe(chip.titleTo)
    })
  })

  it('← 从链接之后一次跨回别名最后一个字之前', () => {
    withEditor('前[飞书](https://a.com)后', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      expect(keydown(editor, 'ArrowLeft', chip.to)).toBe(true)
      expect(editor.state.selection.from).toBe(chip.titleTo - 1)
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
      expect(editor.state.selection.from).toBe(chip.titleTo)
      // 行首 = 字面之前（与块首同一位置），打字不会被算进别名
      expect(keydown(editor, 'Home', chip.titleTo)).toBe(true)
      expect(editor.state.selection.from).toBe(chip.from)
    })
  })

  it('前缀格打字：字落在链接**前面**的正文里，链接结构一个字节不动', () => {
    withEditor('前[飞书](https://a.com)后', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      editor.commands.setTextSelection(chip.from)
      typeText(editor, '新')
      expect(editor.getText()).toBe('前新[飞书](https://a.com)后')
      expect(scanWebLinkChipsInDoc(editor.state.doc)[0]).toMatchObject({
        title: '飞书',
        url: 'https://a.com',
      })
    })
  })

  it('块首链接前的空格不再毁链接（用户报障回归）', () => {
    withEditor('[https://www.doubao.com](https://www.doubao.com)  正文', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      editor.commands.setTextSelection(chip.from)
      typeText(editor, ' ')
      // 老实现按「别名开头」处理：空格塞进网址 ⇒ 不再是合法网址 ⇒ 整段字面被拆成纯文本
      expect(editor.getText()).toBe(' [https://www.doubao.com](https://www.doubao.com)  正文')
      expect(scanWebLinkChipsInDoc(editor.state.doc)).toHaveLength(1)
      expect(scanWebLinkChipsInDoc(editor.state.doc)[0].url).toBe('https://www.doubao.com')
    })
  })

  it('前缀格按退格：删链接前面那个字，不是隐藏的 `[`', () => {
    withEditor('前[飞书](https://a.com)后', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      expect(keydown(editor, 'Backspace', chip.from)).toBe(false)
      expect(editor.getText()).toBe('前[飞书](https://a.com)后')
    })
  })

  it('前缀格按 Delete：整条链接被删掉，不留残骸', () => {
    withEditor('前[飞书](https://a.com)后', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      expect(keydown(editor, 'Delete', chip.from)).toBe(true)
      expect(editor.getText()).toBe('前后')
      expect(scanWebLinkChipsInDoc(editor.state.doc)).toHaveLength(0)
    })
  })

  it('Enter 在前缀格：就地分段，别把光标拖到链接后面', () => {
    withEditor('前[飞书](https://a.com)后', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      expect(keydown(editor, 'Enter', chip.from)).toBe(false)
      expect(editor.state.selection.from).toBe(chip.from)
      expect(editor.getText()).toBe('前[飞书](https://a.com)后')
    })
  })

  it('Enter 在别名中间：光标先移到字面之后，链接不被劈开', () => {
    withEditor('前[飞书](https://a.com)后', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      expect(keydown(editor, 'Enter', chip.titleFrom + 1)).toBe(false)
      expect(editor.state.selection.from).toBe(chip.to)
      expect(editor.getText()).toBe('前[飞书](https://a.com)后')
    })
  })

  it('点击隐藏尾巴（视觉在别名右边）：落到字面之后，接着打的是正文', () => {
    withEditor('前[飞书](https://a.com)后', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      const el = editor.view.dom.querySelector('.web-link-chip') as HTMLElement
      const plugin = editor.state.plugins.find(p => p.key.startsWith('webLinkChip'))
      const handler = plugin!.spec.props.handleClick as
        | ((view: EditorView, pos: number, event: MouseEvent) => boolean)
        | undefined
      expect(handler!(editor.view, chip.to - 1, { target: el } as unknown as MouseEvent)).toBe(true)
      expect(editor.state.selection.from).toBe(chip.to)
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

  it('别名中间打字后光标紧跟插入的字，不往前多跳一格', () => {
    withEditor('[https://a.com](https://a.com)', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      // `h|ttps` 打 `z`：拆成纯文本后光标前应只有 `hz`（曾经多走一格变成 `hzt`）
      expect(textInput(editor, chip.titleFrom + 1, chip.titleFrom + 1, 'z')).toBe(true)
      expect(editor.getText()).toBe('hzttps://a.com')
      expect(editor.state.selection.from).toBe(chip.from + 2)
    })
  })

  it('别名末尾打字、字面仍是合法网址：光标停在新的别名末尾', () => {
    withEditor('[https://a.com](https://a.com)', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      expect(textInput(editor, chip.titleTo, chip.titleTo, 'm')).toBe(true)
      expect(editor.getText()).toBe('[https://a.comm](https://a.comm)')
      const next = scanWebLinkChipsInDoc(editor.state.doc)[0]
      expect(editor.state.selection.from).toBe(next.titleTo)
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

  it('链接视图 Delete 删别名中间字符：删到不像网址就整段拆成文字', () => {
    withEditor('[https://a.com](https://a.com)', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      // 删掉 `https:` 后面的第一个 `/` ⇒ `https:/a.com` 不再是网址
      expect(keydown(editor, 'Delete', chip.titleFrom + 6)).toBe(true)
      expect(editor.getText()).toBe('https:/a.com')
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

describe('WebLinkChipExtension — 选区跨隐藏区按可见区间裁剪', () => {
  function select(editor: Editor, from: number, to: number) {
    editor.commands.setTextSelection({ from, to })
  }

  it('选中「别名后半 + 整段尾巴」退格：别名截短，字面仍完整', () => {
    withEditor('[飞书文档](https://a.com)', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      select(editor, chip.titleFrom + 2, chip.to)
      expect(keydownAtSelection(editor, 'Backspace')).toBe(true)
      expect(editor.getText()).toBe('[飞书](https://a.com)')
      expect(scanWebLinkChipsInDoc(editor.state.doc)[0]).toMatchObject({
        title: '飞书',
        url: 'https://a.com',
      })
    })
  })

  it('链接视图同样选区：URL 两截同步，不会退化成标题视图', () => {
    withEditor('[https://a.com](https://a.com)', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      // 从 `.` 一路选到字面末尾（含 `com` 与 `](url)`）
      select(editor, chip.titleFrom + 9, chip.to)
      expect(keydownAtSelection(editor, 'Backspace')).toBe(true)
      expect(editor.getText()).toBe('[https://a](https://a)')
      expect(scanWebLinkChipsInDoc(editor.state.doc)[0]).toMatchObject({
        title: 'https://a',
        url: 'https://a',
      })
    })
  })

  it('Shift+Home 式的选区（含隐藏前缀 `[`）：别名后半保留，不剩孤零零的 `[`', () => {
    withEditor('[飞书文档](https://a.com)', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      select(editor, chip.from, chip.titleFrom + 2)
      expect(keydownAtSelection(editor, 'Backspace')).toBe(true)
      expect(editor.getText()).toBe('[文档](https://a.com)')
    })
  })

  it('只选中隐藏尾巴：删除是空操作，字面一个字都不动', () => {
    withEditor('[飞书](https://a.com)后', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      select(editor, chip.titleTo + 1, chip.to)
      expect(keydownAtSelection(editor, 'Backspace')).toBe(true)
      expect(editor.getText()).toBe('[飞书](https://a.com)后')
      expect(editor.state.selection.from).toBe(chip.to)
    })
  })

  it('整块 chip 被选中：整段字面一起消失，不留残骸', () => {
    withEditor('前[飞书](https://a.com)后', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      select(editor, chip.from, chip.to)
      expect(keydownAtSelection(editor, 'Delete')).toBe(true)
      expect(editor.getText()).toBe('前后')
    })
  })

  it('两个 chip 一起被选中：各自按可见区间处理，中间文字照删', () => {
    withEditor('前[一](https://a.com)中[二](https://b.com)后', (editor) => {
      const [first, second] = scanWebLinkChipsInDoc(editor.state.doc)
      // 从第一个 chip 的别名末尾选到第二个 chip 的字面末尾
      select(editor, first.titleTo, second.to)
      expect(keydownAtSelection(editor, 'Backspace')).toBe(true)
      expect(editor.getText()).toBe('前[一](https://a.com)后')
      expect(scanWebLinkChipsInDoc(editor.state.doc)).toHaveLength(1)
    })
  })

  it('打字替换跨尾巴选区：字落进别名对应位置，字面仍然完整', () => {
    withEditor('[飞书文档](https://a.com)', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      expect(textInput(editor, chip.titleFrom + 2, chip.to, 'Z')).toBe(true)
      expect(editor.getText()).toBe('[飞书Z](https://a.com)')
      const next = scanWebLinkChipsInDoc(editor.state.doc)[0]
      expect(next).toMatchObject({ title: '飞书Z', url: 'https://a.com' })
      // 光标在别名末尾，接着打的字仍进别名
      expect(editor.state.selection.from).toBe(next.titleTo)
    })
  })

  it('只选中隐藏尾巴后打字：字落到字面之后，别名不被撑长', () => {
    withEditor('[飞书](https://a.com)', (editor) => {
      const chip = scanWebLinkChipsInDoc(editor.state.doc)[0]
      expect(textInput(editor, chip.titleTo + 1, chip.to, 'Z')).toBe(true)
      expect(editor.getText()).toBe('[飞书](https://a.com)Z')
      expect(scanWebLinkChipsInDoc(editor.state.doc)[0]).toMatchObject({ title: '飞书' })
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

describe('WebLinkChipExtension — 改回成合法网址时重新成链（ADR-0067 D8）', () => {
  /** 走默认管线插入：handler 已经登记好编辑区，这里只补上 ProseMirror 那一步 */
  function defaultInsert(editor: Editor, pos: number, text: string) {
    const tr = editor.state.tr.insertText(text, pos)
    tr.setSelection(TextSelection.create(tr.doc, pos + text.length))
    editor.view.dispatch(tr)
  }

  it('删掉错字、文本重新合法：原位重新成 chip，光标停在原处', () => {
    withEditor('hzttps://a.com', (editor) => {
      // 光标在 `z` 之后，退格删掉它（插件放行默认删除）
      expect(keydown(editor, 'Backspace', 3)).toBe(false)
      editor.view.dispatch(editor.state.tr.delete(2, 3))
      expect(editor.getText()).toBe('[https://a.com](https://a.com)')
      expect(scanWebLinkChipsInDoc(editor.state.doc)).toHaveLength(1)
      // 光标仍停在 `h` 之后（字面前多了一格 `[`）
      expect(editor.state.selection.from).toBe(3)
    })
  })

  it('补上漏掉的字、句中网址重新成 chip：只包网址本身', () => {
    withEditor('htps://a.com 尾巴', (editor) => {
      expect(textInput(editor, 3, 3, 't')).toBe(false)
      defaultInsert(editor, 3, 't')
      expect(editor.getText()).toBe('[https://a.com](https://a.com) 尾巴')
      expect(scanWebLinkChipsInDoc(editor.state.doc)[0]).toMatchObject({
        title: 'https://a.com',
        url: 'https://a.com',
      })
    })
  })

  it('同段别处编辑不会顺手包住远处的裸网址', () => {
    withEditor('https://a.com 和 x', (editor) => {
      const end = editor.state.doc.content.size - 1
      expect(textInput(editor, end, end, 'y')).toBe(false)
      defaultInsert(editor, end, 'y')
      expect(editor.getText()).toBe('https://a.com 和 xy')
      expect(scanWebLinkChipsInDoc(editor.state.doc)).toHaveLength(0)
    })
  })
})
