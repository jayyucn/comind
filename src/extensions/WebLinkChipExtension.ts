/**
 * 编辑态 markdown 外链 chip（ADR-0067）。
 *
 * 读态由 Rust 的 `external_link` 段渲染 chip；编辑态的 content 仍是 `[别名](url)` 字面，
 * 这里用 ProseMirror decoration 把非别名字符零宽隐藏（`pm-prefix-hidden` 与标题/列表
 * 前缀同一套 CSS），只在屏幕上露出别名，两态视觉一致。文档一个字都不改 —— 保存、
 * 撤销栈与 inlineMarks 偏移仍以完整字面为准。
 *
 * 隐藏区是**可编辑**的真实文本，只靠零宽 CSS 隐藏，不加 `contenteditable=false`：
 * 不可编辑的 inline 元素之后 Chromium 摆不出插入符，`→` 走到 `[` 前会被甩回块首
 * （2026-11-26 实测），别名第一个字永远进不去。改由 `normalizeHiddenPos` 统一守卫——
 * 任何落在隐藏区的**编辑**都被重定向到最近的可编辑位置：前缀格 → **字面之前**
 * （`chip.from`，与正文同一语义），尾巴格 → 字面之后（`chip.to`）。
 *
 * 前缀格必须是「字面之前」而不是「别名开头」：那一格在像素上与别名首字重合，若按
 * 别名处理，在块首链接前打一个空格就会把 `[url](url)` 重建成长串纯文本、链接当场
 * 消失（2026-11-26 用户报障）。判成「字面之前」后，打字/退格/粘贴都只动正文，
 * 链接结构永远不参与编辑。
 *
 * 视觉上 `[`/`](url)` 的 advance 都是 0，四个边界压在两个像素上：
 * 前缀格 = `chip.from` 与 `titleFrom` 重合，尾巴格 = `titleTo` 与 `chip.to` 重合。
 * 方向键因此按「视觉格」走，不按文档位置走，否则同一像素上会有两个落点、要按两次才动。
 *
 * 选区跨隐藏区（Shift+方向键、拖选、双击选词都会圈进来）按**可见区间**裁剪，见
 * `planVisibleDelete`：删的永远是屏幕上看得见的字，字面不会剩半截。
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
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from '@tiptap/pm/state'
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

/**
 * 用户这次编辑落下之前登记的位置（默认管线执行完由 `appendTransaction` 消费）。
 * `from/to` 是**编辑前**的文档坐标，映射到新文档后再判断是否与裸网址相交。
 */
interface PendingEdit {
  from: number
  to: number
  /** 登记时刻：宿主若吞掉了这次按键（没有产生文档变更），到点自动作废 */
  at: number
}

/**
 * 文本块里可自动成链的纯文本区间：跳过 chip 字面，也跳过行内代码
 * （ADR-0067 D2：行内代码里的字面不参与链接语义）。
 */
function plainTextRanges(
  doc: PMNode,
  chips: WebLinkChipMatch[],
  start: number,
  end: number,
): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = []
  doc.nodesBetween(start, end, (node, pos) => {
    if (!node.isText) return true
    if (node.marks.some(mark => mark.type.name === 'code')) return false
    const nodeEnd = Math.min(pos + node.nodeSize, end)
    let cursor = Math.max(pos, start)
    for (const chip of chips) {
      if (chip.to <= cursor || chip.from >= nodeEnd) continue
      if (chip.from > cursor) out.push({ start: cursor, end: chip.from })
      cursor = Math.max(cursor, chip.to)
    }
    if (cursor < nodeEnd) out.push({ start: cursor, end: nodeEnd })
    return false
  })
  return out
}

/**
 * 本次编辑附近是否有一段**刚刚变合法**的裸网址。
 *
 * 与 `planBareUrlWrap` 的差别：不再要求网址收在光标之前。链接视图里把网址改坏会整段
 * 拆成纯文本，用户把错字改回来时（补漏字 / 删多字）光标在网址**中间**，只看「光标前
 * 那截」永远命中不了 —— 链接就再也回不来。
 *
 * 只认与编辑区间有交集的那一段，避免顺带把同段里其它裸网址也包成 chip；chip 字面内部
 * 的文本一律跳过（那里由 chip 自己的重建路径负责）。
 */
function findBareUrlNearEdit(
  doc: PMNode,
  chips: WebLinkChipMatch[],
  editFrom: number,
  editTo: number,
): { start: number; end: number; url: string } | null {
  const $pos = doc.resolve(Math.max(1, Math.min(editFrom, doc.content.size - 1)))
  if (!$pos.parent.isTextblock) return null
  for (const range of plainTextRanges(doc, chips, $pos.start(), $pos.end())) {
    const text = doc.textBetween(range.start, range.end, '\n', '\n')
    // 区间里有行内原子（图片等）时文本与坐标不再一一对应，这一截直接跳过
    if (text.length !== range.end - range.start) continue
    const re = new RegExp(`https?://[${URL_CHAR}]+`, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const start = range.start + m.index
      const end = start + m[0].length
      if (end < editFrom || start > editTo) continue
      return { start, end, url: m[0] }
    }
  }
  return null
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

/**
 * 把落在隐藏区里的位置收回到**可编辑**落点。
 *
 * 隐藏区的字符 advance 为 0，屏幕上与相邻的可见位置重合，但没有对应的可见语义：
 * 光标停在 `[` 与别名首字之间时，打字到底算不算改别名，用户无从判断。这里一刀切成：
 *
 * - 前缀格（`[` 覆盖的那一格，含 `chip.from` 与别名首字前的 `titleFrom`）→ `chip.from`：
 *   **字面之前**，与链接后面的正文同语义。在这里打的字成为链接前面的普通文字，
 *   `[url](url)` 一个字节都不动。判成「别名开头」会静默重建字面：块首链接前打一个
 *   空格，`[url](url)` 就变成长串纯文本、链接消失（2026-11-26 用户报障）。
 * - 尾巴格（`](url)` 内部）→ `chip.to`：可见字符已经写完，打的字属于后面的正文。
 *
 * 两个端点 `chip.from` / `chip.to` 本身是合法落点，原样返回。
 */
function normalizeHiddenPos(chips: WebLinkChipMatch[], pos: number): number {
  for (const chip of chips) {
    if (pos >= chip.from && pos <= chip.titleFrom) return chip.from
    if (pos > chip.titleTo && pos < chip.to) return chip.to
  }
  return pos
}

/**
 * 删除类操作统一收口：选区跨隐藏区时按**可见区间**裁剪。
 *
 * 隐藏区（前缀 `[` 与尾巴 `](url)`）在 DOM 里是真实文本节点，Shift+方向键、鼠标拖选、
 * 双击选词都能把它们圈进选区；照默认路径删就会啃掉字面 —— 轻则 `[飞书文档](https://a.com`
 * 这种残骸，重则整行只剩一个 `[`（2026-11-26 实测）。这里按「屏幕上看到的字符」删：
 *
 * - 别名被整体选中 ⇒ 整段字面一起消失；
 * - 只选中几个字 ⇒ 只掉那几个字（链接视图两截同步重建，标题视图只动别名）；
 * - 一个别名字符都没选中（只圈中隐藏字符）⇒ 字面原样保留，删除是空操作。
 *
 * 返回 null 表示选区没碰到任何 chip，交给 ProseMirror 默认处理。
 */
function planVisibleDelete(state: EditorState, from: number, to: number): Transaction | null {
  const chips = scanWebLinkChipsInDoc(state.doc).filter(c => from < c.to && to > c.from)
  if (chips.length === 0) return null

  const tr = state.tr
  // 起点落在别名内部时，光标得跟着别名走：`replaceWith` 会把区间里的位置映射到替换
  // 内容末尾，照默认映射会把光标甩到链接之后（接着打的字就跑到字面外面去了）
  let caretIn: { chipFrom: number; offset: number } | null = null
  for (const chip of chips) {
    if (from >= chip.titleFrom && from <= chip.titleTo) {
      caretIn = { chipFrom: chip.from, offset: from - chip.titleFrom }
    }
  }
  // 从右往左：先删右侧，左侧坐标不漂
  let right = to
  for (let i = chips.length - 1; i >= 0; i--) {
    const chip = chips[i]
    // chip 与下一个 chip 之间的普通文字
    const segFrom = Math.max(from, chip.to)
    if (right > segFrom) tr.delete(segFrom, right)

    const a = Math.max(from, chip.titleFrom)
    const b = Math.min(to, chip.titleTo)
    if (b > a) {
      const marks = state.doc.resolve(chip.titleFrom).marks()
      const next = chip.title.slice(0, a - chip.titleFrom) + chip.title.slice(b - chip.titleFrom)
      if (!next) {
        tr.delete(chip.from, chip.to)
      } else if (chip.title === chip.url) {
        // 链接视图：URL 那截跟着改，否则字面会退化成「标题视图 + 旧地址」
        const literal = isWebLinkUrl(next) ? chipLiteral(next, next) : next
        tr.replaceWith(chip.from, chip.to, state.schema.text(literal, marks))
      } else {
        tr.replaceWith(chip.from, chip.to, state.schema.text(chipLiteral(next, chip.url), marks))
      }
    }
    right = Math.min(right, chip.from)
  }
  if (right > from) tr.delete(from, right)

  const caret = normalizeHiddenPos(
    scanWebLinkChipsInDoc(tr.doc),
    caretIn ? tr.mapping.map(caretIn.chipFrom) + 1 + caretIn.offset : tr.mapping.map(from),
  )
  tr.setSelection(TextSelection.near(tr.doc.resolve(caret), -1))
  return tr
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

/** 行首光标：块首恰好是 chip 时放到**字面之前**（`titleFrom` 与 `[` 同像素，语义上属于别名） */
function visibleLineStart(state: EditorState, chips: WebLinkChipMatch[]): number {
  const blockStart = state.selection.$from.start()
  const first = chips[0]
  return first && first.from <= blockStart ? first.from : blockStart
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
/** 标记「这一笔是插件自己补的自动成链」，避免 appendTransaction 自我递归 */
const AUTO_LINK_META = 'webLinkAutoLink'

export const WebLinkChipExtension = Extension.create({
  name: 'webLinkChip',

  addProseMirrorPlugins() {
    /** IME 合成进行中：合成中间态（拼音/候选）会逐次进 DOM，不能跟着往外搬 */
    let composingAtTail = false
    /** 合成起手停在块尾别名末尾时记下别名原文，提交后据此把增长的那截搬回正文 */
    let composedTail: { from: number; url: string; title: string } | null = null
    /**
     * 走默认管线的用户编辑（普通打字、退格、Delete）登记在这里。默认管线跑完，
     * `appendTransaction` 检查这次编辑是不是把某段纯文本「改回」成了合法网址。
     * 只登记用户编辑 —— setContent 之类的程序化改动不进这个口，否则加载旧文档时
     * 会把历史里的裸网址全部改写。
     */
    let pendingEdit: PendingEdit | null = null

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
                /**
                 * 前后两截语法都**不加** `contenteditable=false`：不可编辑的零宽 inline
                 * 之后 Chromium 摆不出插入符（会甩回 chip 左边，别名首字前永远落不住）。
                 * 隐藏完全交给零宽 CSS；落进隐藏区的编辑由 `handleKeyDown` 开头的
                 * `normalizeHiddenPos` 与 `handleTextInput` 的兜底重定向接住。
                 */
                Decoration.inline(chip.from, chip.titleFrom, {
                  class: 'pm-prefix-hidden',
                }),
                Decoration.inline(chip.titleTo, chip.to, {
                  class: 'pm-prefix-hidden',
                }),
              )
            }
            return DecorationSet.create(state.doc, decorations)
          },

          handleKeyDown(view, event) {
            /**
             * 隐藏区可编辑（前后两截都不带 `contenteditable=false`），浏览器能把光标
             * 摆进零宽字面里。任何单键操作之前先把落点收回可编辑位置：`[` 那一格算
             * 「字面之前」，`](url)` 内部算「字面之后」。这样退格/Delete/Enter 都不会
             * 啃到语法字符，用户也感觉不到隐藏字符的存在。
             *
             * 扩选区（shift）不收回：选区本来就该能整段覆盖字面，删除/剪切由
             * `planVisibleDelete` 按可见区间裁。
             */
            if (!event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey
              && view.state.selection.empty) {
              const norm = normalizeHiddenPos(
                scanWebLinkChipsInDoc(view.state.doc),
                view.state.selection.from,
              )
              if (norm !== view.state.selection.from) setCaret(view, norm)
            }

            const { selection } = view.state
            /**
             * 退格 / Delete 在交给默认管线之前先登记编辑区：链接视图改坏后字面被拆成
             * 纯文本，用户把错字删掉（补回来）时应当重新成 chip。命中 chip 的分支会
             * 自己 dispatch，那时这次的登记已被同一次 `appendTransaction` 消费掉。
             */
            if ((event.key === 'Backspace' || event.key === 'Delete') && selection.empty) {
              pendingEdit = event.key === 'Backspace'
                ? { from: Math.max(1, selection.from - 1), to: selection.from, at: Date.now() }
                : { from: selection.from, to: Math.min(selection.from + 1, view.state.doc.content.size), at: Date.now() }
            }
            const chips = scanWebLinkChipsInDoc(view.state.doc)
            if (chips.length === 0) return false
            const chipOf = (pos: number) =>
              chips.find(c => pos >= c.from && pos <= c.to)

            // Home / End 是浏览器按 DOM 行盒移动光标，落点会进隐藏的 `[` / `](url)`。
            // 改成块内首/尾的可见位置（End 落在别名末尾，Home 落在别名开头）。
            if ((event.key === 'Home' || event.key === 'End') && selection.empty && !event.shiftKey) {
              if (!selection.$from.parent.isTextblock) return false
              setCaret(view, event.key === 'End' ? visibleLineEnd(view.state, chips) : visibleLineStart(view.state, chips))
              return true
            }

            if (event.key === 'ArrowRight' && selection.empty) {
              const chip = chipOf(selection.from)
              if (!chip) return false
              const pos = selection.from
              /**
               * 前缀格（`[` 那一格）在 normalize 之后就是 `chip.from`，即「字面之前」。
               * 它和别名首字同像素，所以按右一次必须直接跨到 `titleFrom + 1`：让默认
               * 路径走一格只会挪到同像素的 `titleFrom`（肉眼不动），下一次又被 normalize
               * 拉回 `chip.from`，原地打转。
               *
               * 别名末尾（titleTo）与链接之后（chip.to）同样只隔着零宽的 `](url)`，
               * 落在两者上插入符**画在同一个像素位置**。逐个跨的话第一次按键毫无动静
               * （用户反馈「在链接右侧按右键要按两次才动」），所以一次跨到链接之后的下一格。
               * 块尾 chip 的 `chip.to` 就是可见行尾，右边没有可停位置，原地不动。
               */
              if (pos < chip.titleFrom) {
                setCaret(view, chip.titleFrom + 1)
                return true
              }
              if (pos >= chip.titleTo) {
                if (chip.to >= selection.$from.end()) return true
                setCaret(view, chip.to + 1)
                return true
              }
              return false
            }

            if (event.key === 'ArrowLeft' && selection.empty) {
              const chip = chipOf(selection.from)
              if (!chip) return false
              const pos = selection.from
              // 与 ArrowRight 对称：从别名首字前（`titleFrom`）往左，一次跨过零宽的前缀格
              if (pos > chip.from && pos <= chip.titleFrom) {
                setCaret(view, chip.from - 1)
                return true
              }
              // 尾巴格同样不在「链接之后」这一格再停一次，直接跨回别名最后一个字之前
              if (pos > chip.titleTo && pos <= chip.to) {
                setCaret(view, Math.max(chip.titleFrom, chip.titleTo - 1))
                return true
              }
              return false
            }

            if (event.key === 'Enter' && selection.empty) {
              const chip = chipOf(selection.from)
              if (!chip) return false
              // 站在字面之前（前缀格）就是正文位置：Enter 就地分段，别把光标拖到链接后面
              if (selection.from === chip.from) return false
              // chip 是不可分割的行内单元：先把光标送到字面之后，再让默认的
              // splitBlock 执行。否则 `[别名](url)` 会被从中间劈成两段，链接失效。
              setCaret(view, chip.to)
              return false
            }

            if (event.key === 'Backspace') {
              if (!selection.empty) {
                // 选区可能圈进了隐藏的 `[` / `](url)`：按可见区间删，别留下残缺字面
                const tr = planVisibleDelete(view.state, selection.from, selection.to)
                if (!tr) return false
                view.dispatch(tr)
                return true
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
                // 别名左侧是隐藏的 `[`：跳过它，删掉 chip 之前的可见字符。
                // chip 正好是块首时没有可删的字，交回默认路径（EnterAsBlock 会走与
                // 上一块合并），别在这里 return true 吞掉整次按键——那就是「按退格没反应」。
                if (chip.from <= 1) return false
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
                const tr = planVisibleDelete(view.state, selection.from, selection.to)
                if (!tr) return false
                view.dispatch(tr)
                return true
              }
              const chip = chipOf(selection.from)
              if (!chip) return false
              const pos = selection.from
              if (pos === chip.from) {
                // 前缀格 = 字面之前：Delete 删的是**下一个可见单元**，也就是整条链接本身。
                // 别落到默认路径——那会先啃掉隐藏的 `[`，字面当场变残骸。
                replaceChipLiteral(view, chip, '')
                return true
              }
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
            // 打字替换选区：选区可能圈进隐藏区，先按可见区间删，再插入
            if (from !== to) {
              const tr = planVisibleDelete(view.state, from, to)
              if (!tr) return false
              const at = tr.selection.from
              tr.insertText(text, at)
              tr.setSelection(TextSelection.create(tr.doc, at + text.length))
              view.dispatch(tr)
              return true
            }
            /**
             * 插入点落在隐藏区：这里是零宽字面的内部，打字会把 `[` / `](url)`
             * 拆成半截。先收到可编辑落点再插 —— 前缀格等价于「在链接前面写正文」
             * （`[url](url)` 一个字节都不动），尾巴格等价于「接着写正文」（URL 同理）。
             *
             * 键盘路径由 `handleKeyDown` 的 normalize 提前收口，走到这里的只有
             * 鼠标拖选、输入法自动填等旁路。
             */
            const at = normalizeHiddenPos(chips, from)
            if (at !== from) {
              const tr = view.state.tr.insertText(text, at)
              tr.setSelection(TextSelection.create(
                tr.doc,
                Math.min(at + text.length, tr.doc.content.size - 1),
              ))
              view.dispatch(tr)
              return true
            }
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
              /**
               * 落点相对整个字面的起点算：`[` 那一格只在字面仍是 chip 时存在。
               * 判成纯文本还加 1 的话，插入的字虽然位置对，光标却往前多跳一格
               * （`h|ttps` 打 `s` 得 `hst|tps`，2026-11-27 用户报障）。
               */
              const caretAt = valid
                ? chip.from + 1 + before.length + text.length
                : chip.from + before.length + text.length
              replaceChipLiteral(view, chip, replacement, caretAt)
              return true
            }

            // 裸网址实时成 chip：句中的网址只包它自己，前后文字不动
            const wrap = planBareUrlWrap(view.state, from, to, text, chips)
            if (!wrap) {
              // 交给默认管线：登记这次编辑，等 appendTransaction 看是否「改回」成网址
              pendingEdit = { from, to, at: Date.now() }
              return false
            }
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

          /**
           * 粘贴替换选区：选区可能圈进隐藏区，照默认路径粘贴会连字面一起吃掉
           * （`[飞书文档](https://a.com)` 变成 `[飞书X`）。
           */
          handlePaste(view, _event, slice) {
            // 粘贴不是「改错字」：别让上一次按键留下的登记把贴上来的文字包成 chip
            pendingEdit = null
            const { selection } = view.state
            if (selection.empty) {
              /**
               * 空选区落在隐藏区：先收到可见落点，再让默认粘贴按新落点执行。
               * 不自己插文本是为了保住 ProseMirror 的整条粘贴管线（多段、图片、HTML）。
               */
              const at = normalizeHiddenPos(scanWebLinkChipsInDoc(view.state.doc), selection.from)
              if (at !== selection.from) setCaret(view, at)
              return false
            }
            const tr = planVisibleDelete(view.state, selection.from, selection.to)
            if (!tr) return false
            tr.replaceSelection(slice)
            view.dispatch(tr)
            return true
          },

          handleDOMEvents: {
            /**
             * 拖放落在零宽语法里：默认路径会把落点算在隐藏字符中间，插入后字面必定残缺。
             * 这里直接吃掉这次拖放（内容留在原处，用户重拖到可见位置即可）——
             * 拒绝一次拖放比静默毁掉链接安全。
             */
            drop(view, event) {
              const at = view.posAtCoords({
                left: (event as DragEvent).clientX,
                top: (event as DragEvent).clientY,
              })?.pos
              if (at === undefined) return false
              const chips = scanWebLinkChipsInDoc(view.state.doc)
              return normalizeHiddenPos(chips, at) !== at
            },
            /**
             * 剪切同样是「删选区」：跨隐藏区时会留下残缺字面。剪贴板照常写完整字面
             * （粘回来还能成为 chip），文档按可见区间删。
             */
            cut(view, event) {
              const { selection } = view.state
              if (selection.empty) return false
              const tr = planVisibleDelete(view.state, selection.from, selection.to)
              if (!tr) return false
              const { dom, text } = view.serializeForClipboard(selection.content())
              event.clipboardData?.setData('text/html', dom.innerHTML)
              event.clipboardData?.setData('text/plain', text)
              event.preventDefault()
              view.dispatch(tr)
              return true
            },
            compositionstart(view) {
              composingAtTail = false
              composedTail = null
              const sel = view.state.selection
              if (!sel.empty) return false
              const chips = scanWebLinkChipsInDoc(view.state.doc)
              /**
               * 输入法合成不走 `handleKeyDown` 的 normalize：若光标正停在零宽语法里，
               * 合成出来的字会直接落进 `[` / `](url)` 中间，把字面拆散。起手先把落点
               * 收回可编辑位置，再让浏览器开始合成。
               */
              const at = normalizeHiddenPos(chips, sel.from)
              if (at !== sel.from) {
                setCaret(view, at)
                return false
              }
              const tail = titleChipAtBlockTail(view.state.doc, chips, sel.from)
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
            // 点隐藏的 `](url)`（视觉上就是别名右边）：算「链接之后」，接着写正文；
            // 点 `[` 那格或别名最左缘：算「字面之前」（与 `normalizeHiddenPos` 同口径），
            // 打字/退格只动正文；点别名内部：落到字面对应位置。
            // 也不让 StarterKit 的 link mark 把编辑态点击变成打开网页。
            const caret = pos > chip.titleTo
              ? chip.to
              : pos <= chip.titleFrom
                ? chip.from
                : pos
            setCaret(view, caret)
            return true
          },
        },

        /**
         * 把「改回成合法网址」的纯文本重新包成 chip。
         *
         * 链接视图里改坏一个字符会让字面整段拆成纯文本（ADR-0067 D8：别名与目标必须
         * 一致）。用户把错字改回来时理应恢复链接，但默认管线只负责把字插入/删掉，
         * 旧的检测又只看「光标前那截」，光标在网址中间就永远命中不了。这里在用户编辑
         * 之后补一道：编辑区间与某段裸网址相交、且它现在完全合法 ⇒ 原位包成 chip。
         *
         * 只处理用户编辑（`pendingEdit` 由 handleTextInput / handleKeyDown 登记），
         * 程序化 setContent 不走这条路。
         */
        appendTransaction(transactions, _oldState, newState) {
          const tr = transactions[transactions.length - 1]
          /**
           * 先判「这次真的改了文档」再取登记：宿主的键盘链路常在真正的删除之前先补
           * 一笔只改选区的交易（焦点/选区同步），那一笔不能把登记吃掉，否则紧随
           * 其后的删除永远等不到这次检测。
           */
          if (!tr.docChanged || tr.getMeta(AUTO_LINK_META)) return null
          const edit = pendingEdit
          if (!edit) return null
          pendingEdit = null
          // 登记太久才来的文档变更不是这次按键造成的（宿主吞键、异步合并等）
          if (Date.now() - edit.at > 2000) return null
          const from = tr.mapping.map(edit.from, -1)
          const to = tr.mapping.map(edit.to, 1)
          const chips = scanWebLinkChipsInDoc(tr.doc)
          // 编辑落在 chip 字面内部：那是链接视图自己的重建路径，这里不插手
          if (chips.some(c => from > c.from && to < c.to)) return null
          const hit = findBareUrlNearEdit(tr.doc, chips, from, to)
          if (!hit) return null

          const literal = chipLiteral(hit.url, hit.url)
          const marks = newState.doc.resolve(hit.start).marks()
          const next = newState.tr.replaceWith(
            hit.start,
            hit.end,
            newState.schema.text(literal, marks),
          )
          // 光标落点：重建后字面前多了一格 `[`；落在网址右侧则整体右移字面的增量
          const caret = tr.selection.from
          const delta = literal.length - hit.url.length
          const mapped = caret <= hit.start
            ? caret
            : caret <= hit.end
              ? caret + 1
              : caret + delta
          next.setSelection(TextSelection.create(
            next.doc,
            Math.max(1, Math.min(mapped, next.doc.content.size - 1)),
          ))
          next.setMeta(AUTO_LINK_META, true)
          return next
        },
      }),
    ]
  },
})
