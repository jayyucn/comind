/**
 * Markdown 外链 chip 的字面读写单源（ADR-0067）。
 *
 * content 里的形态：`[标题](https://…)`；渲染层只显示标题。
 * 前后可有任意普通文本 —— chip 是 text 块正文的**片段**，不是块。
 *
 * 本模块只处理字面串，不碰 store；拆块/改块由服务层调用这些函数。
 */
import { domainOf } from './web-link'

/** 与 Rust `RE_MD_LINK` 同源：`\[([^\[\]]+)\]\((https?://[^\s)]+)\)` */
const MD_LINK_RE = /\[([^[\]]+)\]\((https?:\/\/[^\s)]+)\)/g

export interface WebLinkChipSpan {
  /** chip 在 content 里的起止（JS UTF-16 下标，与 String.slice 同） */
  start: number
  end: number
  /** 显示标题 */
  title: string
  /** 原始 URL */
  url: string
}

/** 找出 content 里所有 markdown 外链 chip（返回副本，正则 lastIndex 不泄漏） */
export function findWebLinkChips(content: string): WebLinkChipSpan[] {
  const out: WebLinkChipSpan[] = []
  MD_LINK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = MD_LINK_RE.exec(content)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length, title: m[1], url: m[2] })
  }
  return out
}

/** content 是否恰好是一个 chip（前后无其它文本，允许首尾空白） */
export function webLinkChipOnly(content: string): WebLinkChipSpan | null {
  const chips = findWebLinkChips(content)
  if (chips.length !== 1) return null
  const chip = chips[0]
  if (content.slice(0, chip.start).trim() !== '') return null
  if (content.slice(chip.end).trim() !== '') return null
  return chip
}

/**
 * 按「url + 标题」定位 content 里的那一个 chip。
 *
 * 悬浮条手里只有从 DOM 读来的 url/标题，没有字面下标，服务层只能靠内容反查。
 * 口径与编辑态的 `replaceActiveChip`（`scanWebLinkChipsInDoc`）一致：
 * 同 url 不同别名靠标题区分；同 url 同别名（用户手打两份）取第一个。
 *
 * 不要用 `webLinkChipOnly` 代替 —— 那个要求「整块恰一个 chip 且前后无文本」，
 * 块里只要有前后文字或第二个 chip，改链接/切视图/切卡片就会静默失效。
 */
export function findWebLinkChip(
  content: string,
  target: { url: string; title?: string },
): WebLinkChipSpan | null {
  const chips = findWebLinkChips(content)
  const exact = chips.find(c => c.url === target.url && (target.title === undefined || c.title === target.title))
  return exact ?? chips.find(c => c.url === target.url) ?? null
}

/** 拼一个 chip 字面 */
export function webLinkChipMarkdown(title: string, url: string): string {
  // 标题里出现 `]` 会破坏语法；用全角替身，保住可解析性
  return `[${title.split('[').join('｜').split(']').join('｜')}](${url})`
}

/**
 * chip 两种文本视图对应的别名（ADR-0067：视图 = 显示文字是否等于 URL）。
 *
 * - 链接视图 = URL 原文，字面 `[url](url)`；
 * - 标题视图 = 域名（`webLinkTitle` 回退链的第二档），无域名时退回 URL。
 *
 * 这两个「视图」不是独立存储的开关，切换就是改写别名字面；用户手写的别名
 * 在切到链接视图时会被 URL 覆盖，靠撤销恢复。
 */
export function chipAliasForView(url: string, view: 'link' | 'title'): string {
  if (view === 'link') return url
  const domain = domainOf(url)
  return domain || url
}

/** 替换 content 里第一个匹配 chip 的字面（按 start/end，避免误伤同串文本） */
export function replaceWebLinkChip(content: string, span: WebLinkChipSpan, replacement: string): string {
  return content.slice(0, span.start) + replacement + content.slice(span.end)
}

/** 按 chip 拆成「前 / chip / 后」三段（前、后可能为空串） */
export function splitAroundChip(content: string, span: WebLinkChipSpan): { before: string; after: string } {
  return { before: content.slice(0, span.start), after: content.slice(span.end) }
}

/**
 * 标题别名是否被用户改过（alias 锁定判据的字面来源）。
 *
 * 抓取到的 meta.title 与 chip 当前 title 不一致时视为「用户已改」——
 * 之后重抓不再覆盖 alias（ADR-0067）。
 */
export function chipAliasLocked(chip: WebLinkChipSpan, fetchedTitle: string | undefined): boolean {
  return !!fetchedTitle && chip.title !== fetchedTitle
}
