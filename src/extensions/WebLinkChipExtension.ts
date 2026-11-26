/**
 * 编辑态 markdown 外链 chip（ADR-0067）。
 *
 * 读态由 Rust 的 `external_link` 段渲染 chip；编辑态的 content 仍是 `[别名](url)` 字面，
 * 这里用 ProseMirror decoration 把非别名字符零宽隐藏（`pm-prefix-hidden` 与标题/列表
 * 前缀同一套 CSS），只在屏幕上露出别名，两态视觉一致。文档一个字都不改 —— 保存、
 * 撤销栈与 inlineMarks 偏移仍以完整字面为准。
 *
 * 隐藏区加 `contenteditable=false`：光标钻不进 `(url)`。但 ProseMirror 的退格/Delete
 * 走自己的 keymap，不受浏览器 contenteditable 限制，所以另有最小键盘护栏：
 * 方向键跨过隐藏区；退格/Delete 只作用于可见别名一个字，别名删空则整段 chip 消失。
 *
 * 链接视图（别名 = URL）直接打字会同步改两截字面；一旦不再像网址就拆掉隐藏 URL、
 * 只留用户输入。标题视图只改别名，URL 交给 ProseMirror 默认逐字编辑，保持不动。
 */
import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/** 与 `utils/web-link-chip.ts` 的 MD_LINK_RE 同源 */
const MD_LINK_RE = /\[([^[\]]+)\]\((https?:\/\/[^\s)]+)\)/g
const URL_RE = /^https?:\/\/[^\s)]+$/

export interface WebLinkChipMatch {
  /** PM 文档坐标：整段字面 [from, to) */
  from: number
  to: number
  /** 可见别名区间 [titleFrom, titleTo)，也是唯一允许打字/删除的地方 */
  titleFrom: number
  titleTo: number
  title: string
  url: string
}

/** 扫描当前文档里的外链 chip；行内代码里的字面不认（与读态掩白同口径） */
export function scanWebLinkChipsInDoc(doc: PMNode): WebLinkChipMatch[] {
  const out: WebLinkChipMatch[] = []
  doc.descendants((node, pos) => {
    if (!node.isText) return
    if (node.marks?.some(mark => mark.type.name === 'code')) return
    const text = node.text ?? ''
    MD_LINK_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = MD_LINK_RE.exec(text)) !== null) {
      const from = pos + m.index
      const titleFrom = from + 1
      const titleTo = titleFrom + m[1].length
      out.push({
        from,
        to: from + m[0].length,
        titleFrom,
        titleTo,
        title: m[1],
        url: m[2],
      })
    }
  })
  return out
}

/** 标题里的方括号会破坏字面语法；与 `webLinkChipMarkdown` 同口径换成全角替身 */
export function chipLiteral(title: string, url: string): string {
  return `[${title.split('[').join('｜').split(']').join('｜')}](${url})`
}

/** 链接视图下编辑后的文字是否仍是合法网址 */
export function isWebLinkUrl(text: string): boolean {
  return URL_RE.test(text)
}

function setCaret(view: EditorView, pos: number): void {
  const clamped = Math.max(1, Math.min(pos, view.state.doc.content.size - 1))
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, clamped)))
}

/** 把 chip 整段换成 replacement（保留别名首字符的 marks），光标落在别名末尾 */
export function replaceChipLiteral(
  view: EditorView,
  chip: WebLinkChipMatch,
  replacement: string,
  caretOffset?: number,
): void {
  const mark = view.state.doc.resolve(chip.titleFrom).marks()
  const tr = view.state.tr
  if (replacement) {
    tr.replaceWith(chip.from, chip.to, view.state.schema.text(replacement, mark))
  } else {
    // 别名删空：整段字面一起消失（ProseMirror 不接受空文本节点）
    tr.delete(chip.from, chip.to)
  }
  const caretAt = caretOffset ?? replacement.length
  const caret = chip.from + Math.min(caretAt, replacement.length)
  tr.setSelection(TextSelection.create(tr.doc, Math.max(1, Math.min(caret, tr.doc.content.size - 1))))
  view.dispatch(tr)
}

/** 选区落在别名内、且删完别名会空时，整段拆掉 chip */
function selectedAliasWouldEmpty(sel: { from: number; to: number }, chip: WebLinkChipMatch): boolean {
  if (sel.empty) return false
  if (sel.from < chip.from || sel.to > chip.to) return false
  const a = Math.max(sel.from, chip.titleFrom)
  const b = Math.min(sel.to, chip.titleTo)
  return (chip.title.slice(0, a - chip.titleFrom) + chip.title.slice(b - chip.titleFrom)) === ''
}

const WEB_LINK_CHIP_KEY = new PluginKey('webLinkChip')

export const WebLinkChipExtension = Extension.create({
  name: 'webLinkChip',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: WEB_LINK_CHIP_KEY,

        props: {
          decorations(state) {
            const decorations: Decoration[] = []
            for (const chip of scanWebLinkChipsInDoc(state.doc)) {
              decorations.push(
                Decoration.inline(chip.from, chip.to, {
                  class: 'block-link external web-link-chip',
                  'data-external': chip.url,
                  'data-chip-url': chip.url,
                  'data-chip-title': chip.title,
                }),
                Decoration.inline(chip.from, chip.titleFrom, {
                  class: 'pm-prefix-hidden',
                  contenteditable: 'false',
                }),
                Decoration.inline(chip.titleTo, chip.to, {
                  class: 'pm-prefix-hidden',
                  contenteditable: 'false',
                }),
              )
            }
            return DecorationSet.create(state.doc, decorations)
          },

          handleKeyDown(view, event) {
            const { selection } = view.state
            const chips = scanWebLinkChipsInDoc(view.state.doc)
            if (chips.length === 0) return false
            const chipOf = (pos: number) =>
              chips.find(c => pos >= c.from && pos <= c.to)

            if (event.key === 'ArrowRight' && selection.empty) {
              const chip = chipOf(selection.from)
              if (!chip) return false
              const pos = selection.from
              if (pos < chip.titleFrom) {
                setCaret(view, chip.titleFrom)
                return true
              }
              if (pos >= chip.titleTo && pos < chip.to) {
                setCaret(view, chip.to)
                return true
              }
              return false
            }

            if (event.key === 'ArrowLeft' && selection.empty) {
              const chip = chipOf(selection.from)
              if (!chip) return false
              const pos = selection.from
              if (pos > chip.from && pos <= chip.titleFrom) {
                setCaret(view, chip.from)
                return true
              }
              if (pos > chip.titleTo && pos <= chip.to) {
                setCaret(view, chip.titleTo)
                return true
              }
              return false
            }

            if (event.key === 'Backspace') {
              if (!selection.empty) {
                const chip = chips.find(c => selectedAliasWouldEmpty(selection, c))
                if (!chip) return false
                replaceChipLiteral(view, chip, '')
                return true
              }
              const chip = chipOf(selection.from)
              if (!chip) return false
              const pos = selection.from
              if (pos === chip.titleTo && chip.title.length === 1) {
                replaceChipLiteral(view, chip, '')
                return true
              }
              if (pos > chip.titleTo && pos < chip.to) {
                setCaret(view, chip.titleTo)
                return true
              }
              if (pos === chip.titleFrom) {
                // 别名左侧是隐藏的 `[`：跳过它，删掉 chip 之前的可见字符
                if (chip.from <= 1) return true
                view.dispatch(view.state.tr.delete(chip.from - 1, chip.from))
                return true
              }
              return false
            }

            if (event.key === 'Delete') {
              if (!selection.empty) {
                const chip = chips.find(c => selectedAliasWouldEmpty(selection, c))
                if (!chip) return false
                replaceChipLiteral(view, chip, '')
                return true
              }
              const chip = chipOf(selection.from)
              if (!chip) return false
              const pos = selection.from
              if (pos === chip.titleFrom && chip.title.length === 1) {
                replaceChipLiteral(view, chip, '')
                return true
              }
              if (pos === chip.titleTo) {
                // 别名右侧是隐藏的 `](url)`：跳过它，删 chip 之后的可见字符
                if (chip.to >= view.state.doc.content.size) return true
                view.dispatch(view.state.tr.delete(chip.to, chip.to + 1))
                return true
              }
              if (pos > chip.titleTo && pos < chip.to) {
                setCaret(view, chip.titleTo)
                return true
              }
              return false
            }

            return false
          },

          handleTextInput(view, from, to, text) {
            const chip = scanWebLinkChipsInDoc(view.state.doc).find(
              c => c.title === c.url && from >= c.titleFrom && to <= c.titleTo,
            )
            if (!chip) return false

            const before = chip.title.slice(0, from - chip.titleFrom)
            const after = chip.title.slice(to - chip.titleFrom)
            const next = before + text + after
            const valid = isWebLinkUrl(next)
            const replacement = valid ? chipLiteral(next, next) : next
            const caretAt = chip.from + 1 + before.length + text.length
            replaceChipLiteral(view, chip, replacement, caretAt)
            return true
          },

          handleClick(view, pos, event) {
            const target = event.target as HTMLElement | null
            const chipEl = target?.closest?.('.web-link-chip') as HTMLElement | null
            if (!chipEl) return false
            const chip = scanWebLinkChipsInDoc(view.state.doc).find(
              c => c.url === chipEl.dataset.chipUrl,
            )
            if (!chip) return false
            // 点击只读别名区，不让光标落进隐藏的 `(url)`；也不让 StarterKit 的
            // link mark 把编辑态点击变成打开网页。
            const caret = Math.max(chip.titleFrom, Math.min(pos, chip.titleTo))
            setCaret(view, caret)
            return true
          },
        },
      }),
    ]
  },
})
