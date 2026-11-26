/**
 * 编辑态 markdown 外链 chip（ADR-0067）。
 *
 * 读态由 Rust 的 `external_link` 段渲染 chip；编辑态的 content 仍是 `[别名](url)` 字面，
 * 这里用 ProseMirror decoration 把非别名字符零宽隐藏（`pm-prefix-hidden` 与标题/列表
 * 前缀同一套 CSS），只在屏幕上露出别名，两态视觉一致。文档一个字都不改 —— 保存、
 * 撤销栈与 inlineMarks 偏移仍以完整字面为准。
 *
 * 隐藏区只给前缀 `[` 加 `contenteditable=false`：光标钻不进 `(` 那一侧。尾巴 `](url)`
 * **不能**加 —— 零宽 inline-block 且不可编辑的尾巴之后，Chromium 摆不出插入符：光标停在
 * chip 之后（退格删掉链接后面的字、→ 跨过 chip）时，插入符会被甩到 chip 左边，接着打的字
 * 还会插到链接前面（2026-11-26 实测）。尾巴可编辑后 `chip.to` 就是合法插入位，代价是默认
 * 退格会啃掉隐藏的 `)`，所以另有最小键盘护栏：方向键跨过隐藏区；退格/Delete 只作用于可见
 * 别名一个字（停在 `chip.to` 时算「别名最后一个字」），别名删空则整段 chip 消失。
 *
 * 键入裸网址即时成 chip（`[url](url)`，链接视图）：见 `planBareUrlWrap`。包完之后光标
 * 落在别名末尾，后续字符由下面的链接视图分支继续同步两截，所以逐字包裹不会重复触发。
 *
 * 链接视图（别名 = URL）直接打字会同步改两截字面；一旦不再是网址就拆掉隐藏 URL、
 * 只留用户输入。但在别名末尾打空格/标点不是「改网址」，那是接着写正文 —— 字符落到
 * chip 右侧，链接保留。标题视图只改别名，URL 交给 ProseMirror 默认逐字编辑。
 *
 * 例外：chip 正好在块尾时，别名末尾就是这一行的最后一个可见字符（尾巴零宽），
 * 那时在别名末尾打的字一律算正文（见 `titleChipAtBlockTail`），否则用户永远写不出
 * chip 之后的字。想改别名末尾的字，先按 → 走到 `chip.to` 再改。
 */
import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { type EditorState, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/** 与 `utils/web-link-chip.ts` 的 MD_LINK_RE 同源 */
const MD_LINK_RE = /\[([^[\]]+)\]\((https?:\/\/[^\s)]+)\)/g

/**
 * 网址里允许出现的字符：排除空白与括号。
 *
 * 括号必须排除——`[别名](url)` 的字面语法用 `)` 收尾，URL 里带 `)` 会让字面解析不完整，
 * 包成 chip 反而写坏正文。中文标点同样不在集合内，所以「https://a.com，然后」里的逗号
 * 天然成为网址边界，不会被吃进 URL。
 */
const URL_CHAR = 'A-Za-z0-9\\-._~:/?#@!$&*+,;=%'
const URL_ONLY_RE = new RegExp(`^https?://[${URL_CHAR}]+$`)
/** 光标前那截文字的末尾是否正好是一段网址 */
const URL_TAIL_RE = new RegExp(`https?://[${URL_CHAR}]+$`)

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
  return URL_ONLY_RE.test(text)
}

/**
 * 键入裸网址时要包成 chip 的区间计划。
 *
 * `from/to/text` 是 ProseMirror 即将插入的那一笔（尚未落进文档），所以「光标前的字 +
 * 本次插入的字」拼起来才是插入后的真实文本。只在末尾正好是网址时命中：
 * `明天看 https://a.com 再定` 里正在打的 `https://a.c` 补上 `o` 就正好命中，
 * 已存在的 `[别名](url)` chip 内部不重复包裹（光标在 chip 里时由 chip 分支接走）。
 */
function planBareUrlWrap(
  state: EditorState,
  from: number,
  to: number,
  text: string,
  chips: WebLinkChipMatch[],
): { start: number; url: string } | null {
  if (from !== to) return null
  if (chips.some(c => from >= c.from && from <= c.to)) return null
  const $from = state.doc.resolve(from)
  if (!$from.parent.isTextblock) return null
  const parentStart = $from.start()
  const before = state.doc.textBetween(parentStart, from, '\n', '\n')
  const url = (before + text).match(URL_TAIL_RE)?.[0]
  if (!url) return null
  const start = from - (url.length - text.length)
  if (start < parentStart) return null
  return { start, url }
}

function setCaret(view: EditorView, pos: number): void {
  const clamped = Math.max(1, Math.min(pos, view.state.doc.content.size - 1))
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, clamped)))
}

/**
 * 把 chip 整段换成 replacement（保留别名首字符的 marks）。
 *
 * `caretAt` 是**文档绝对位置**（不是相对 chip 的偏移）；缺省落到替换文本末尾。
 * 传相对偏移会让光标多走一个 `chip.from`，落进隐藏区之后 —— 表现为「接着打的字插到了字面外面」。
 */
export function replaceChipLiteral(
  view: EditorView,
  chip: WebLinkChipMatch,
  replacement: string,
  caretAt?: number,
): void {
  const mark = view.state.doc.resolve(chip.titleFrom).marks()
  const tr = view.state.tr
  if (replacement) {
    tr.replaceWith(chip.from, chip.to, view.state.schema.text(replacement, mark))
  } else {
    // 别名删空：整段字面一起消失（ProseMirror 不接受空文本节点）
    tr.delete(chip.from, chip.to)
  }
  const caret = caretAt ?? chip.from + replacement.length
  tr.setSelection(TextSelection.create(
    tr.doc,
    Math.max(1, Math.min(caret, tr.doc.content.size - 1)),
  ))
  view.dispatch(tr)
}

/**
 * 链接视图（别名 = URL）下删掉别名的若干字符：两截必须一起重建。
 *
 * 只删可见那一截会得到 `[https://a.co](https://a.com)` —— 字面不再满足 title === url，
 * 立刻被判成标题视图，屏幕上的字和点开的地址从此不一致。所以删除也走整段替换：
 * 剩下的仍是网址就重建 `[新网址](新网址)`，否则按打字同口径拆掉隐藏 URL、只留文字。
 *
 * `caretInAlias` 是删完后光标在别名里的偏移；`replaceChipLiteral` 收的是文档绝对位置。
 */
function deleteInLinkView(
  view: EditorView,
  chip: WebLinkChipMatch,
  nextAlias: string,
  caretInAlias: number,
): void {
  if (!nextAlias) {
    replaceChipLiteral(view, chip, '')
    return
  }
  if (isWebLinkUrl(nextAlias)) {
    replaceChipLiteral(view, chip, chipLiteral(nextAlias, nextAlias), chip.from + 1 + caretInAlias)
    return
  }
  replaceChipLiteral(view, chip, nextAlias, chip.from + caretInAlias)
}

/** 选区落在别名内、且删完别名会空时，整段拆掉 chip */
function selectedAliasWouldEmpty(sel: { from: number; to: number }, chip: WebLinkChipMatch): boolean {
  if (sel.empty) return false
  if (sel.from < chip.from || sel.to > chip.to) return false
  const a = Math.max(sel.from, chip.titleFrom)
  const b = Math.min(sel.to, chip.titleTo)
  return (chip.title.slice(0, a - chip.titleFrom) + chip.title.slice(b - chip.titleFrom)) === ''
}

/**
 * 行尾光标：块尾恰好是 chip 时收到别名末尾。
 *
 * End 的语义是「本行最后一个可见字符之后」——chip 在块尾时那就是别名末尾（`](url)` 零宽，
 * 右边没有字）。落在 `chip.to` 会把光标放到「链接之后」那一格，接着打字虽然也在外面，
 * 但和「行尾」不是一回事，且链接视图下会去改网址。
 */
function visibleLineEnd(state: EditorState, chips: WebLinkChipMatch[]): number {
  const blockEnd = state.selection.$from.end()
  const last = chips[chips.length - 1]
  return last && last.to >= blockEnd ? last.titleTo : blockEnd
}

/** 行首光标：块首恰好是 chip 时放到别名开头（`chip.from` 同理落在隐藏的 `[` 里） */
function visibleLineStart(state: EditorState, chips: WebLinkChipMatch[]): number {
  const blockStart = state.selection.$from.start()
  const first = chips[0]
  return first && first.from <= blockStart ? first.titleFrom : blockStart
}

/**
 * chip 是否正好是所在文本块的末尾。
 *
 * 这是「别名末尾 = 可见行尾」的条件：后面还有字时，可见行尾在后面的字上；
 * 只有 chip 收尾时，别名末尾才是这一行的最后一个可见字符。
 */
function chipEndsBlock(doc: PMNode, chip: WebLinkChipMatch): boolean {
  const $to = doc.resolve(chip.to)
  return $to.parentOffset === $to.parent.content.size
}

/**
 * 标题视图 + chip 在块尾：别名末尾打的字属于**正文**，落到字面之后。
 *
 * 块尾 chip 的别名末尾就是可见行尾（隐藏尾巴零宽，右边没有字），不接管的话每个字符都被
 * 吃进别名，用户再也写不出 chip 之后的正文。
 *
 * 代价：块尾 chip 的别名末尾不能再直接改字（那里的键入算正文）。改标题走悬浮条
 * 「编辑链接」，或在别名中间点一下；`chip.to` 那一格打字同样算正文。
 */
function titleChipAtBlockTail(
  doc: PMNode,
  chips: WebLinkChipMatch[],
  pos: number,
): WebLinkChipMatch | null {
  return chips.find(c =>
    c.title !== c.url && c.titleTo === pos && chipEndsBlock(doc, c),
  ) ?? null
}

const WEB_LINK_CHIP_KEY = new PluginKey('webLinkChip')

export const WebLinkChipExtension = Extension.create({
  name: 'webLinkChip',

  addProseMirrorPlugins() {
    /** IME 合成进行中：合成中间态（拼音/候选）会逐次进 DOM，不能跟着往外搬 */
    let composingAtTail = false
    /** 合成起手停在块尾别名末尾时记下别名原文，提交后据此把增长的那截搬回正文 */
    let composedTail: { from: number; url: string; title: string } | null = null

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
                /**
                 * 尾巴（`](url)`）**不加** `contenteditable=false`：不可编辑的零宽 inline-block
                 * 之后 Chromium 摆不出插入符（会甩回 chip 左边），而 `chip.to` 正是「链接之后」
                 * 唯一能落光标的那一格。隐藏靠零宽 CSS，不靠 contenteditable。
                 */
                Decoration.inline(chip.titleTo, chip.to, {
                  class: 'pm-prefix-hidden',
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

            // Home / End 是浏览器按 DOM 行盒移动光标，落点可能进隐藏的 `[` / `](url)`：
            // 之后打的字会插到字面外面（表现为「打字跑到链接前面去了」）。改成块内首/尾。
            // Home / End 是浏览器按 DOM 行盒移动光标，落点会进隐藏的 `[` / `](url)`；
            // 那个位置 Chromium 存不住，插入符随即被弹回块首。改成块内首/尾的可见位置。
            if ((event.key === 'Home' || event.key === 'End') && selection.empty && !event.shiftKey) {
              if (!selection.$from.parent.isTextblock) return false
              setCaret(view, event.key === 'End' ? visibleLineEnd(view.state, chips) : visibleLineStart(view.state, chips))
              return true
            }

            if (event.key === 'ArrowRight' && selection.empty) {
              const chip = chipOf(selection.from)
              if (!chip) return false
              const pos = selection.from
              if (pos < chip.titleFrom) {
                setCaret(view, chip.titleFrom)
                return true
              }
              if (pos >= chip.titleTo && pos < chip.to) {
                // 块尾是 chip 时，别名末尾就是可见行尾，再往右没有可停的位置
                if (chip.to >= selection.$from.end()) return true
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
                if (chip) {
                  replaceChipLiteral(view, chip, '')
                  return true
                }
                const linkChip = chips.find(
                  c => c.title === c.url && selection.from >= c.titleFrom && selection.to <= c.titleTo,
                )
                if (linkChip) {
                  const a = selection.from - linkChip.titleFrom
                  const b = selection.to - linkChip.titleFrom
                  deleteInLinkView(view, linkChip, linkChip.title.slice(0, a) + linkChip.title.slice(b), a)
                  return true
                }
                return false
              }
              const chip = chipOf(selection.from)
              if (!chip) return false
              const pos = selection.from
              /**
               * 光标停在 `chip.to`（链接之后的那一格）：插入符左边是隐藏的 `)`。
               * 放行默认退格会把网址啃掉一个字符（`[u](https://a.co` 这种字面就废了），
               * 所以按「删可见的最后一个字」处理，与在别名末尾退格同语义。
               */
              if (pos === chip.to) {
                if (chip.title.length === 1) {
                  replaceChipLiteral(view, chip, '')
                  return true
                }
                if (chip.title === chip.url) {
                  const nextAlias = chip.title.slice(0, -1)
                  deleteInLinkView(view, chip, nextAlias, nextAlias.length)
                  return true
                }
                // 标题视图：只掉别名最后一个字，隐藏 URL 不动
                view.dispatch(view.state.tr.delete(chip.titleTo - 1, chip.titleTo))
                return true
              }
              if (pos === chip.titleTo && chip.title.length === 1) {
                replaceChipLiteral(view, chip, '')
                return true
              }
              if (pos === chip.titleFrom) {
                // 别名左侧是隐藏的 `[`：跳过它，删掉 chip 之前的可见字符
                if (chip.from <= 1) return true
                view.dispatch(view.state.tr.delete(chip.from - 1, chip.from))
                return true
              }
              if (pos > chip.titleFrom && pos <= chip.titleTo && chip.title === chip.url) {
                // 链接视图删别名一个字：URL 那截一起改，否则字面会退化成标题视图 + 旧地址
                const i = pos - chip.titleFrom
                deleteInLinkView(view, chip, chip.title.slice(0, i - 1) + chip.title.slice(i), i - 1)
                return true
              }
              if (pos > chip.titleTo && pos < chip.to) {
                setCaret(view, chip.titleTo)
                return true
              }
              return false
            }

            if (event.key === 'Delete') {
              if (!selection.empty) {
                const chip = chips.find(c => selectedAliasWouldEmpty(selection, c))
                if (chip) {
                  replaceChipLiteral(view, chip, '')
                  return true
                }
                const linkChip = chips.find(
                  c => c.title === c.url && selection.from >= c.titleFrom && selection.to <= c.titleTo,
                )
                if (linkChip) {
                  const a = selection.from - linkChip.titleFrom
                  const b = selection.to - linkChip.titleFrom
                  deleteInLinkView(view, linkChip, linkChip.title.slice(0, a) + linkChip.title.slice(b), a)
                  return true
                }
                return false
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
              if (pos >= chip.titleFrom && pos < chip.titleTo && chip.title === chip.url) {
                // 与退格对称：链接视图删别名一个字，URL 那截一起改
                const i = pos - chip.titleFrom
                deleteInLinkView(view, chip, chip.title.slice(0, i) + chip.title.slice(i + 1), i)
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
            const chips = scanWebLinkChipsInDoc(view.state.doc)
            const tail = !composingAtTail && from === to
              ? titleChipAtBlockTail(view.state.doc, chips, from)
              : null
            if (tail && text) {
              // 块尾 chip：字符落到字面之后，链接与别名原样保留
              const tr = view.state.tr.insertText(text, tail.to)
              tr.setSelection(TextSelection.create(tr.doc, tail.to + text.length))
              view.dispatch(tr)
              return true
            }
            // 光标真落进隐藏尾巴内部（`](url)` 的字缝里）：那里不该有插入点，
            // 把字写到字面之后，别去改网址
            const inTail = chips.find(c => from === to && from > c.titleTo && from < c.to)
            if (inTail) {
              const tr = view.state.tr.insertText(text, inTail.to)
              tr.setSelection(TextSelection.create(tr.doc, inTail.to + text.length))
              view.dispatch(tr)
              return true
            }
            const chip = chips.find(
              c => c.title === c.url && from >= c.titleFrom && to <= c.titleTo,
            )
            if (chip) {
              const before = chip.title.slice(0, from - chip.titleFrom)
              const after = chip.title.slice(to - chip.titleFrom)
              const next = before + text + after
              const valid = isWebLinkUrl(next)
              // 在链接末尾打空格 / 标点 = 接着写正文，不是改网址：链接保留，字符落右侧。
              // 否则每打完一个链接都要被标点拆散，句读写完 chip 就没了。
              if (!valid && from === to && from === chip.titleTo) {
                const tr = view.state.tr.insertText(text, chip.to)
                tr.setSelection(TextSelection.create(
                  tr.doc,
                  Math.min(chip.to + text.length, tr.doc.content.size - 1),
                ))
                view.dispatch(tr)
                return true
              }
              const replacement = valid ? chipLiteral(next, next) : next
              const caretAt = chip.from + 1 + before.length + text.length
              replaceChipLiteral(view, chip, replacement, caretAt)
              return true
            }

            // 裸网址实时成 chip：句中的网址只包它自己，前后文字不动
            const wrap = planBareUrlWrap(view.state, from, to, text, chips)
            if (!wrap) return false
            const marks = view.state.doc.resolve(wrap.start).marks()
            const tr = view.state.tr.replaceWith(
              wrap.start,
              to,
              view.state.schema.text(chipLiteral(wrap.url, wrap.url), marks),
            )
            tr.setSelection(TextSelection.create(tr.doc, wrap.start + 1 + wrap.url.length))
            view.dispatch(tr)
            return true
          },

          handleDOMEvents: {
            compositionstart(view) {
              composingAtTail = false
              composedTail = null
              const sel = view.state.selection
              if (!sel.empty) return false
              const tail = titleChipAtBlockTail(
                view.state.doc,
                scanWebLinkChipsInDoc(view.state.doc),
                sel.from,
              )
              if (tail) {
                composingAtTail = true
                composedTail = { from: tail.from, url: tail.url, title: tail.title }
              }
              return false
            },
            /**
             * IME 合成绕过 `handleTextInput`：ProseMirror 边合成边把预编辑文本同步进文档，
             * 块尾 chip 的别名照样被撑长。合成结束后把多出来那一截搬回正文，语义与键入一致。
             *
             * 合成中间态（拼音、候选）一律不搬——否则每敲一个字母就搬出去一段碎片。
             * 收尾用 setTimeout 排在 ProseMirror 自己的 flush 之后（微任务先于宏任务），
             * 那时文档才是最终态。
             */
            compositionend(view) {
              composingAtTail = false
              const pending = composedTail
              composedTail = null
              if (!pending) return false
              setTimeout(() => {
                if (view.isDestroyed) return
                const chips = scanWebLinkChipsInDoc(view.state.doc)
                const next = chips.find(c => c.from === pending.from && c.url === pending.url)
                if (!next || next.title.length <= pending.title.length) return
                if (!next.title.startsWith(pending.title)) return
                // 合成把别名整段改写了，按新别名重建字面，增长的那一截落到正文
                const grown = next.title.slice(pending.title.length)
                const literal = chipLiteral(pending.title, next.url)
                const marks = view.state.doc.resolve(next.titleFrom).marks()
                const tr = view.state.tr.replaceWith(
                  next.from,
                  next.to,
                  view.state.schema.text(literal, marks),
                )
                const at = next.from + literal.length
                tr.insertText(grown, at)
                tr.setSelection(TextSelection.create(tr.doc, at + grown.length))
                view.dispatch(tr)
              }, 0)
              return false
            },
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
