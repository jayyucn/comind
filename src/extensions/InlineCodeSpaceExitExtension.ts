import { Extension } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'
import { Plugin, PluginKey } from '@tiptap/pm/state'

/**
 * 行内代码（`` `x` ``）末尾**连敲两个空格** → 跳出代码，与 markdown / Typora 同感。
 *
 * ProseMirror 的 mark 默认是 inclusive 的：光标停在代码字后面时继续输入仍带 code，
 * 于是「敲完代码想接着写正文」必须先按方向键或再敲一次反引号。这里把「代码末尾 +
 * 连续两个空格」当作结束信号：第二个空格与后续输入都不再带 code。
 *
 * 为什么必须两个空格：打字是逐字符的，`const a = 1` 里每个空格落键那一刻都处在
 * 「代码末尾」（光标后面还没字），单空格跳出会让多词代码根本打不出来。两个空格既
 * 保住代码内的单个空格，又给出无歧义的离开动作；触发时把代码内那个尾部空格一并
 * 收掉（两空格并成一个），代码里不留看不见的行尾空白。
 *
 * 只在**末尾**生效 —— 光标后面仍是代码（在代码中间打字）时交给默认行为，
 * `a b` 这类代码内空格照旧属于代码。
 */
export const inlineCodeSpaceExitKey = new PluginKey('inlineCodeSpaceExit')

/** 光标处是否正处于行内代码的**末尾**（后面已无代码内容）。 */
export function atInlineCodeEnd(state: EditorState, from: number): boolean {
  const codeType = state.schema.marks.code
  if (!codeType) return false
  const $from = state.doc.resolve(from)
  // 光标后面的字符仍带 code ⇒ 这是代码中间，空格属于代码内容
  const after = $from.nodeAfter
  if (after && after.marks.some(mark => mark.type === codeType)) return false
  const active = state.storedMarks ?? $from.marks()
  return active.some(mark => mark.type === codeType)
}

/** 光标前紧邻的字符是不是 `code` 里的空格 —— 即刚落下的第一个空格。 */
export function endsWithInlineCodeSpace(state: EditorState, from: number): boolean {
  const codeType = state.schema.marks.code
  if (!codeType) return false
  const before = state.doc.resolve(from).nodeBefore
  if (!before || !before.isText) return false
  if (!(before.text ?? '').endsWith(' ')) return false
  // mark 边界会把文本节点切开，所以这个尾部空格本身带不带 code 看节点 marks 即可
  return before.marks.some(mark => mark.type === codeType)
}

/** 连敲两个空格的第二下：可以跳出代码。 */
export function shouldExitInlineCode(state: EditorState, from: number): boolean {
  return atInlineCodeEnd(state, from) && endsWithInlineCodeSpace(state, from)
}

const InlineCodeSpaceExitExtension = Extension.create({
  name: 'inlineCodeSpaceExit',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: inlineCodeSpaceExitKey,
        props: {
          handleTextInput(view, from, to, text) {
            // 只接管单字符空格；粘贴/IME 走各自路径
            if (text !== ' ' || from !== to) return false
            const { state } = view
            // 第一个空格照常写进代码：代码里的空格是有意义的
            if (!shouldExitInlineCode(state, from)) return false

            const codeType = state.schema.marks.code
            const active = state.storedMarks ?? state.doc.resolve(from).marks()
            const marks = active.filter(mark => mark.type !== codeType)

            // 两个空格并成一个：把代码内那个尾部空格换成代码外的空格。
            // 显式带上除 code 外的 marks，保证加粗/字色不被这次替换丢掉。
            const tr = state.tr.replaceWith(from - 1, to, state.schema.text(' ', marks))
            // 必须在 replaceWith 之后设：`Transaction.addStep` 会把 storedMarks 清空
            tr.setStoredMarks(marks)
            view.dispatch(tr)
            return true
          },
        },
      }),
    ]
  },
})

export default InlineCodeSpaceExitExtension
