/**
 * 最小 Markdown 内联渲染（issue T6，richtext 特化的展示侧）。
 *
 * 仓库无既有 markdown 渲染依赖（content 渲染层为纯文本 / block-link 自绘），
 * 按工单约定走最小实现：不引第三方依赖，只支持换行、粗体、斜体、行内代码、
 * 链接五类语法，纯函数 + 可测。
 *
 * 安全：先整体 HTML 转义再套标记，任何输入不会产生 HTML 注入面（v-html 消费前提）。
 */

/** HTML 转义（& < > " '），防注入的第一道也是唯一一道闸。 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 行内标记：链接 → 粗体 → 斜体（顺序不可换：粗体先于斜体，避免 `**` 被斜体截胡）。
 *  链接 href 过 toExternalHref 闸（javascript: 等危险 scheme 拒渲染降级纯文本）——
 *  这是 code-review Spec#1 修的存储型 XSS 面：escapeHtml 只防 HTML 注入，防不了
 *  合法属性值里的 javascript: scheme。 */
function renderLine(line: string): string {
  const esc = escapeHtml(line)
  return esc
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
      const href = toExternalHref(url)
      return href
        ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`
        : label
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
}

/**
 * 最小 markdown 渲染：按行渲染后以 <br> 连接；行内代码（`x`）优先摘出——
 * 其内容只转义、不参与其他标记，避免代码里的 `*` / `[` 被误渲染。
 */
export function renderInlineMarkdown(src: string): string {
  return src
    .split('\n')
    .map((line) =>
      line
        .split(/(`[^`]+`)/g)
        .map((part) =>
          part.length >= 2 && part.startsWith('`') && part.endsWith('`')
            ? `<code>${escapeHtml(part.slice(1, -1))}</code>`
            : renderLine(part),
        )
        .join(''),
    )
    .join('<br>')
}

/**
 * 外链 href 归一：无 scheme 补 https://；非 http(s) / mailto 的 scheme
 * （javascript: 等）返回 null 拒渲染——url 特化字段与 md 链接共用此闸。
 */
export function toExternalHref(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  return /^(https?:\/\/|mailto:)/i.test(withScheme) ? withScheme : null
}
