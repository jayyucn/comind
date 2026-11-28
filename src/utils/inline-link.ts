/**
 * 行内外链（markdown `[标题](url)`）的写入口约束 —— 单一权威实现。
 *
 * 字面由 Rust `render_segment_service` 的 RE_MD_LINK 解析：
 * `\[([^\[\]]+)\]\((https?://[^\s)]+)\)`。两条正则边界决定了「什么能写进去」，
 * 不是审美选择：
 * - 标题含 `[`/`]` → 整段不匹配，屏幕上退回纯文本（静默断链，用户看不出原因）；
 * - URL 含 `)` 或空白 → `)` 收尾提前闭合，剩下的字符漏进正文。
 *
 * 与页名约束（`page-name.ts`）**不同源**：那边还禁 `|`（别名分隔符）与换行
 * （`[[ ]]` 语法边界），这些在链接标题里都合法，不能拉过来复用。
 */

/** 标题判据：`null` = 可用作标题；否则是给用户看的拒绝原因（含具体字符） */
export function linkTitleRejectionHint(raw: string): string | null {
  const title = raw.trim()
  if (!title) return '选区不能作为链接文字，选区只有空白'
  const bad: string[] = []
  if (title.includes('[')) bad.push('[')
  if (title.includes(']')) bad.push(']')
  // 硬换行（Shift-Enter）在 content 里就是 `\n`：RE_MD_LINK 的 `[^\[\]]+` 会跨过它，
  // 段因此劈开行盒（chip 变两行），编辑态的装饰也会错位。与页名判据同一条理由。
  const hasBreak = title.includes('\n') || title.includes('\r')
  if (bad.length === 0 && !hasBreak) return null
  const labels = [...bad.map(ch => `「${ch}」`), ...(hasBreak ? ['换行'] : [])].join('')
  return `选区不能作为链接文字，不能包含${labels}`
}

/**
 * URL 可用字符：与 RE_MD_LINK 的 `[^\s)]+` 取交集后再排除 markdown 边界字符。
 *
 * 中文标点天然落在集合外，所以「看过 https://a.com，然后」抽到的是 `https://a.com`
 * —— 抽取靠字符集划边界，不靠词法猜测。
 */
const URL_CHARS = /https?:\/\/[A-Za-z0-9\-._~:/?#@!$&'*+,;=%]+/i
const BARE_HOST = /(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}(?::\d+)?(?:\/[A-Za-z0-9\-._~:/?#@!$&'*+,;=%]*)?/g

/**
 * 从任意文本里抽出一个可用的 http(s) URL。
 *
 * - 已带协议：取首个 `https?://…` 片段（其余丢弃）；
 * - 只写域名：补 `https://`（用户输 `feishu.cn` 是常态）；
 * - 两者都没有：`null`（调用方据此禁用「插入」）。
 *
 * 裸域名的**前一个字符**也必须不是 ASCII 词元：否则 `mailto:a@b.com` 会被抽成
 * `https://b.com`（邮箱变成网站），`a.feishu.cn` 会被抽成一截。这里不用 lookbehind
 * —— 逐字符判断在各种构建目标下都不会被转译掉。
 *
 * `javascript:` / `mailto:` 等一律不认 —— `openExternalUrl` 只放行 http(s)，
 * 写进正文也是死链。
 */
export function extractHttpUrl(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null
  const withScheme = text.match(URL_CHARS)
  if (withScheme) return withScheme[0]
  for (const bare of text.matchAll(BARE_HOST)) {
    const at = bare.index ?? 0
    const before = at > 0 ? text[at - 1]! : ''
    if (/[A-Za-z0-9@._-]/.test(before)) continue
    return `https://${bare[0]}`
  }
  return null
}

/** 拼出要写进正文的字面（标题与 URL 都必须已过上面两道判据） */
export function buildInlineLinkLiteral(title: string, url: string): string {
  return `[${title.trim()}](${url})`
}
