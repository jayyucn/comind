import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import Bold from '@tiptap/extension-bold'
import Code from '@tiptap/extension-code'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import InlineCodeSpaceExitExtension, {
  atInlineCodeEnd,
  endsWithInlineCodeSpace,
  shouldExitInlineCode,
} from './InlineCodeSpaceExitExtension'

interface Handle {
  editor: Editor
  element: HTMLElement
}

let handle: Handle | null = null

function createEditor(content: string): Handle {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({
    element,
    extensions: [Document, Paragraph, Text, Bold, Code, InlineCodeSpaceExitExtension],
    content,
  })
  handle = { editor, element }
  return handle
}

afterEach(() => {
  handle?.editor.destroy()
  handle?.element.remove()
  handle = null
})

/** 走真实的 `handleTextInput` 路径（只有本扩展声明了它）。 */
function typeSpace(editor: Editor, pos: number): boolean {
  const plugin = editor.state.plugins.find(
    p => typeof p.spec.props?.handleTextInput === 'function',
  )
  const handler = plugin?.spec.props?.handleTextInput
  if (!handler) throw new Error('handleTextInput plugin missing')
  return handler(editor.view, pos, pos, ' ') !== false
}

/**
 * 敲一次空格：扩展接管就走扩展，不接管则按 ProseMirror 默认行为
 * （带当前 marks）插入 —— 这样才能模拟「连敲两个空格」的真实序列。
 */
function pressSpace(editor: Editor): boolean {
  const pos = codeEndPos(editor)
  if (typeSpace(editor, pos)) return true
  const { state } = editor
  const marks = state.storedMarks ?? state.doc.resolve(pos).marks()
  editor.view.dispatch(state.tr.insertText(' ', pos, pos, marks))
  return false
}

/** 行内代码（可能连续多段）在文档里的结束位置。 */
function codeEndPos(editor: Editor): number {
  let end = 0
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.marks.some(mark => mark.type.name === 'code')) {
      end = pos + node.nodeSize
    }
  })
  return end
}

/** 文档里所有 code mark 文本（按出现顺序）。 */
function codeTexts(editor: Editor): string[] {
  const texts: string[] = []
  editor.state.doc.descendants((node) => {
    if (node.isText && node.marks.some(mark => mark.type.name === 'code')) texts.push(node.text ?? '')
  })
  return texts
}

describe('InlineCodeSpaceExitExtension — 行内代码末尾连敲两个空格跳出', () => {
  it('第一次空格留在代码里（多词代码才打得出来）', () => {
    const { editor } = createEditor('<p><code>const</code></p>')
    const pos = codeEndPos(editor)

    // 光标确实在代码末尾，但只有**一个**空格，不能当作离开信号
    expect(atInlineCodeEnd(editor.state, pos)).toBe(true)
    expect(endsWithInlineCodeSpace(editor.state, pos)).toBe(false)
    expect(shouldExitInlineCode(editor.state, pos)).toBe(false)
    expect(typeSpace(editor, pos)).toBe(false)

    // 走默认行为后，空格进入代码：`const a = 1` 一路打下去不会被踢出来
    expect(pressSpace(editor)).toBe(false)
    expect(codeTexts(editor)).toEqual(['const '])
    // 光标仍在代码里（下一个字继续属于代码）
    expect(
      editor.state.doc.resolve(codeEndPos(editor)).marks().some(mark => mark.type.name === 'code'),
    ).toBe(true)
  })

  it('第二个空格触发跳出，并把两个空格并成一个', () => {
    const { editor } = createEditor('<p><code>abc</code></p>')

    expect(pressSpace(editor)).toBe(false) // 第一下：仍在代码里
    expect(codeTexts(editor)).toEqual(['abc '])

    expect(pressSpace(editor)).toBe(true) // 第二下：跳出
    // 代码里不留行尾空白，代码外只有一个空格
    expect(codeTexts(editor)).toEqual(['abc'])
    expect(editor.getHTML()).toBe('<p><code>abc</code> </p>')
    expect(editor.state.storedMarks?.some(mark => mark.type.name === 'code') ?? false).toBe(false)
  })

  it('跳出后继续输入不再带 code', () => {
    const { editor } = createEditor('<p><code>abc</code></p>')
    pressSpace(editor)
    pressSpace(editor)

    const { state } = editor
    const marks = state.storedMarks ?? []
    expect(marks.some(mark => mark.type.name === 'code')).toBe(false)
    // 按 storedMarks 续写（= 真实打字的取 marks 口径）
    const end = (state.doc.firstChild?.content.size ?? 0) + 1
    editor.view.dispatch(state.tr.insertText('x', end, end, marks))

    expect(codeTexts(editor)).toEqual(['abc'])
    expect(editor.getText()).toBe('abc x')
  })

  it('代码中间的空格仍属于代码（不接管）', () => {
    const { editor } = createEditor('<p><code>ab</code></p>')
    // 光标落在 code 内容中间：后面还是 code
    const pos = codeEndPos(editor) - 1
    expect(atInlineCodeEnd(editor.state, pos)).toBe(false)
    expect(typeSpace(editor, pos)).toBe(false)
  })

  it('代码中间已有空格、光标在空格后也不跳出', () => {
    const { editor } = createEditor('<p><code>a b</code></p>')
    // 光标在 `a ` 之后、`b` 之前
    const pos = codeEndPos(editor) - 1
    expect(endsWithInlineCodeSpace(editor.state, pos)).toBe(true)
    expect(atInlineCodeEnd(editor.state, pos)).toBe(false)
    expect(typeSpace(editor, pos)).toBe(false)
  })

  it('普通文本处的空格完全不受影响', () => {
    const { editor } = createEditor('<p>abcdef</p>')
    expect(atInlineCodeEnd(editor.state, 3)).toBe(false)
    expect(typeSpace(editor, 3)).toBe(false)
    expect(editor.getText()).toBe('abcdef')
  })

  it('紧邻代码的加粗文本不被波及', () => {
    const { editor } = createEditor('<p><code>xy</code><strong>后</strong></p>')
    expect(pressSpace(editor)).toBe(false)
    expect(pressSpace(editor)).toBe(true)
    expect(codeTexts(editor)).toEqual(['xy'])
    expect(editor.getHTML()).toBe('<p><code>xy</code> <strong>后</strong></p>')
  })

  it('代码后紧跟正文时，空格落在代码与正文之间', () => {
    const { editor } = createEditor('<p><code>abc</code>后</p>')
    expect(pressSpace(editor)).toBe(false)
    expect(pressSpace(editor)).toBe(true)
    expect(codeTexts(editor)).toEqual(['abc'])
    // 代码内不留尾部空格，正文前只有一个空格
    expect(editor.getHTML()).toBe('<p><code>abc</code> 后</p>')
    expect(editor.getText()).toBe('abc 后')
  })

  it('中文与 emoji 正文里偏移不受影响', () => {
    const { editor } = createEditor('<p>前缀 <code>代码🙂</code> 后缀</p>')
    expect(pressSpace(editor)).toBe(false)
    expect(pressSpace(editor)).toBe(true)
    expect(codeTexts(editor)).toEqual(['代码🙂'])
    expect(editor.getText()).toBe('前缀 代码🙂  后缀')
  })
})
