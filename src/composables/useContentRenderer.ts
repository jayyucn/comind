import { resolveRelationshipLabel, WIKI_LINK_REGEX, wikiLinkDisplay } from '../services/render-text'
import type { InlineMarkRange } from '../utils/inline-marks'
import { mergeMarkAttrs, wrapInlineHtml } from '../utils/inline-marks'
import { tagChipStyle } from '../utils/tag-color'
import type { RenderInput } from '../wasm/types'

const CSS_CLASSES = {
  blockLink: 'block-link',
  relTypeLabel: 'rel-type-label',
  blockTag: 'block-tag',
  dateRef: 'date-ref',
}

const TAG_PATTERN = '([\\p{L}_][\\p{L}\\p{N}_]*(?:\\/[\\p{L}_][\\p{L}\\p{N}_]*)*)'
// 排除 `"`（data-page 属性值内）与 `[`（[[...]] 内），避免 #tag 与 wiki link 互相污染
// 导出 source 供编辑态（`InlineTagExtension`）复用，两边各持独立实例避免 lastIndex 互踩
export const TAG_TRIGGER_SOURCE = `(?<![\\/|>|@"[])#${TAG_PATTERN}`
const TAG_TRIGGER_REGEX = new RegExp(TAG_TRIGGER_SOURCE, 'gu')

function escapeHtmlEntities(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * tag chip 的内联 `style` 属性（含前导空格；无色返回空串）。
 *
 * 色值来自存储、又要拼进 HTML 属性 —— 故一律经 `tagChipStyle` 的**白名单**收口
 * （ADR-0050 D11），只有名单内的调色板 token 能进来，不给 CSS 注入留面。
 */
function tagStyleAttr(color: string | undefined): string {
  const style = tagChipStyle(color)
  if (!style) return ''
  const decls = Object.entries(style).map(([prop, value]) => `${prop}:${value}`).join(';')
  return ` style="${decls}"`
}

export interface HeadingParseResult {
  level: number
  title: string
}

/**
 * 标题前缀解析。
 *
 * 标题可跨行（Shift-Enter 的硬换行会进正文）：标记只认**首行**，标题文本吃掉剩余的
 * 全部内容（含 `\n`）。因此 `.+` / `.*` 这种默认不跨行的写法不能用 —— 内容里一旦有
 * 换行，正则整体不匹配，标题会静默退回普通正文、连 `# ` 也一起显示出来。
 *
 * @param options.allowEmptyTitle 允许「只有 `# ` 还没有标题文本」也算标题。只有编辑态
 *   预览需要它 —— 敲下 `# ` 就该立刻变大（不必等第一个字），而渲染态若也放宽，会留下
 *   一个空的 `<h1>` 行。默认 false，与历史行为一致。
 */
export function parseHeading(
  text: string,
  options: { allowEmptyTitle?: boolean } = {},
): HeadingParseResult | null {
  // `[^\S\n]` = 除换行以外的空白：标记后的分隔空格不能把行接下去
  const match = options.allowEmptyTitle
    ? text.match(/^(#{1,6})[^\S\n]+([\s\S]*)$/)
    : text.match(/^(#{1,6})[^\S\n]+([\s\S]+)$/)
  if (match) {
    return { level: match[1].length, title: match[2] }
  }
  return null
}

/** 列表种类：无序（`- `）/ 有序（`1. `） */
export type ListKind = 'unordered' | 'ordered'

export interface ListParseResult {
  kind: ListKind
  /** 有序列表的序号；无序为 null */
  index: number | null
  /** 去掉标记后的正文（可能为空串 —— 空列表项仍然算列表项，标记要留住） */
  title: string
}

/**
 * 列表标记的语法（与 `parseHeading` 同一层：都是正文前缀，不是块类型）。
 *
 * - 无序只认 `- `。不认 `* ` / `+ `：`* ` 与行内斜体/乘号的含义冲突，收益远小于歧义。
 * - 有序认 1–9 位数字 + `.` + 空格。`1.5 米` 这种小数不会命中（`.` 后没有空格）。
 * - **空正文也算列表项**（`- ` 单独存在仍画标记）。这点与标题相反 —— `# ` 没有标题文本
 *   就不成立，而列表项可以先是空的、再往里打字。
 */
export function parseList(text: string): ListParseResult | null {
  // 同 `parseHeading`：正文可跨行，标记只认首行，正文吃掉剩余全部（含 `\n`）。
  const ordered = text.match(/^(\d{1,9})\.[^\S\n]([\s\S]*)$/)
  if (ordered) {
    return { kind: 'ordered', index: Number(ordered[1]), title: ordered[2] }
  }
  const unordered = text.match(/^-[^\S\n]([\s\S]*)$/)
  if (unordered) {
    return { kind: 'unordered', index: null, title: unordered[1] }
  }
  return null
}

/**
 * 「段落样式」= 正文前缀所表达的行样式（普通文本 / H1–H3 / 无序 / 有序）。
 *
 * 这六种在本库里**不是块类型**，全是 bullet 块正文的前缀（标题沿 `parseHeading`，
 * 列表沿 `parseList`）。菜单的高亮、入口字形、渲染态的标记、拆分时的续行，全部从这里
 * 取同一份判定 —— 五处各写一遍正则正是这类前缀语法最容易漂移的地方。
 */
export type ParagraphStyle = 'text' | 'h1' | 'h2' | 'h3' | 'ul' | 'ol'

export interface ParagraphStyleInfo {
  /** 可被「文本样式」行点亮的样式；`####` 这类未纳入四格的级别为 null（谁也点不亮） */
  style: ParagraphStyle | null
  /** 标题级别 1–6（非标题为 null）；编辑态标记要按级别出 `H1`…`H6` */
  level: number | null
  /** 前缀在 content 里的长度（0 = 无前缀），渲染态据此把 segments/marks 平移到正文坐标系 */
  prefixLength: number
  /** 去掉前缀后的正文 */
  title: string
  /** 有序列表序号（其余为 null），续行时 +1 */
  listIndex: number | null
}

/**
 * @param options.allowEmptyTitle 同 `parseHeading`：编辑态预览要认「`# ` 还没打字」。
 *   触发样式切换（`setParagraphStyle`）时也应放宽 —— 否则对一个内容为 `# ` 的块点 H2，
 *   会把 `# ` 当成正文拼成 `## # `。
 * @param options.format 标题的**双读兜底**：模板插入的标题块只落了 `format`（
 *   `{type:'heading', level}`），正文里没有前缀（`serialize-block-tree.ts` 的两端契约）。
 *   不喂 format 时这类块会被判成普通正文 —— TOC 认它是标题、渲染却是正文。
 *   只在正文完全没有前缀时才兜底，前缀永远优先（用户一旦改样式就写前缀，format 侧随之清掉）。
 */
export function parseParagraphStyle(
  content: string,
  options: { allowEmptyTitle?: boolean; format?: Record<string, unknown> | null } = {},
): ParagraphStyleInfo {
  const heading = parseHeading(content, options)
  if (heading) {
    const style = heading.level <= 3 ? (`h${heading.level}` as ParagraphStyle) : null
    return {
      style,
      level: heading.level,
      prefixLength: content.length - heading.title.length,
      title: heading.title,
      listIndex: null,
    }
  }
  const list = parseList(content)
  if (list) {
    return {
      style: list.kind === 'ordered' ? 'ol' : 'ul',
      level: null,
      prefixLength: content.length - list.title.length,
      title: list.title,
      listIndex: list.index,
    }
  }
  const legacy = legacyHeadingFromFormat(options.format)
  if (legacy) {
    return { style: legacy.style, level: legacy.level, prefixLength: 0, title: content, listIndex: null }
  }
  return { style: 'text', level: null, prefixLength: 0, title: content, listIndex: null }
}

/**
 * 模板遗留的标题声明：`format.type === 'heading'` + `level`。
 *
 * 与正文前缀并存是本库的既存事实（`TocPanel` 与模板序列化认它，渲染原先不认）。
 * 这里把它折进同一条判定，避免"标题"在渲染与目录两处打架；级别按 1–6 收口，
 * 4–6 级同前缀口径：`style` 为 null（文本样式行点不亮），但 `level` 仍保留。
 */
function legacyHeadingFromFormat(
  format: Record<string, unknown> | null | undefined,
): { style: ParagraphStyle | null; level: number } | null {
  if (!format || format.type !== 'heading') return null
  const raw = typeof format.level === 'number' && Number.isFinite(format.level) ? format.level : 2
  const level = Math.min(6, Math.max(1, Math.trunc(raw)))
  return { style: level <= 3 ? (`h${level}` as ParagraphStyle) : null, level }
}

/** 样式 → 正文前缀。切样式就是整体换掉前缀，正文一个字不动 */
export function paragraphPrefixOf(style: ParagraphStyle, listIndex = 1): string {
  switch (style) {
    case 'h1': return '# '
    case 'h2': return '## '
    case 'h3': return '### '
    case 'ul': return '- '
    case 'ol': return `${listIndex}. `
    default: return ''
  }
}

/**
 * 把「整段 content 坐标系」的 segments 平移到「去掉前缀后的正文」坐标系。
 *
 * 标题与列表在渲染态都要丢掉前缀（`# `、`- `、`1. `），但 segments 是 Rust 按**完整
 * content** 算出来的。不平移就按错的偏移切字 —— 一个含 `#tag` 的标题会渲染出串位的正文。
 * 前缀自身所在的段整个丢弃（那部分已经不在渲染内容里）。
 */
export function shiftSegments(
  segments: import('../wasm/types').RenderSegment[],
  prefixLength: number,
): import('../wasm/types').RenderSegment[] {
  if (prefixLength <= 0) return segments
  const shifted: import('../wasm/types').RenderSegment[] = []
  for (const seg of segments) {
    const end = seg.end - prefixLength
    if (end <= 0) continue
    shifted.push({ ...seg, start: Math.max(0, seg.start - prefixLength), end })
  }
  return shifted
}

/**
 * Escape HTML entities and render #tag patterns + [[wiki links]] within a plain-text segment.
 * Applied only on the original text slice, not on already-rendered HTML,
 * so color hex values won't be accidentally matched.
 *
 * [[...]] 兜底：Rust 的 render_segments 基于 DB links 表构建，当 links 表缺少记录时
 * （旧数据/导入数据），[[target]] 会落入 text 段。此处按结构化 Link segment
 * 的同一 HTML 结构渲染，保证链接样式与点击跳转一致。
 * 「显示哪一段」（别名优先）走 `wikiLinkDisplay`，与 `services/render-text`
 * 的偏移换算共用同一份规则。
 */
function renderTextSegmentWithTags(text: string): string {
  return escapeHtmlEntities(text)
    // 先解析 wiki link：生成的 span 含 `#tag` 时由后续 tag 正则的排除集（`"`/`>`）保护，
    // 避免嵌套替换损坏 HTML
    .replace(WIKI_LINK_REGEX, (_, target: string, display?: string) => {
      // 输入已是 escapeHtmlEntities 后的文本，捕获的 target/display 无需再次转义
      const page = target
      const shown = wikiLinkDisplay(target, display)
      return `<span class="${CSS_CLASSES.blockLink}" data-page="${page}">` +
        `<span class="wiki-bracket">[[</span>${shown}<span class="wiki-bracket">]]</span></span>`
    })
    .replace(TAG_TRIGGER_REGEX, (_, tag) => {
      if (tag.includes('.')) return `#${tag}`
      // ⛔ 兜底 tag 不是页面链接：**不得**带 `data-page`。标签名当页面名交给
      // navigateToPage 后，`/page/<标签名>` 路由守卫查无此页就隐式建页 —— 表现为
      // 「点标签跳进一个新建的空页」。与结构化 Tag 段同口径只留 `data-tag-title`，
      // 点击由宿主反查 tag id 再进聚合页（ADR-0050 D7）。
      // `block-link` 类保留：仅取它的 cursor/hover 观感，点击分支见 useBlockEditorLifecycle。
      return `<span class="${CSS_CLASSES.blockLink} ${CSS_CLASSES.blockTag}" data-tag-title="${escapeHtmlEntities(tag)}">#${escapeHtmlEntities(tag)}</span>`
    })
}

/**
 * 在 [start, end) 文本片段内按行内格式切段并包裹。
 * `markOffset` 用于把 content 坐标系的 marks 平移到当前渲染坐标系（标题去掉 `# ` 前缀时用）。
 */
function renderTextWithMarks(
  text: string,
  start: number,
  end: number,
  marks: InlineMarkRange[] | undefined,
  markOffset: number,
): string {
  if (!marks || marks.length === 0 || end <= start) return renderTextSegmentWithTags(text)

  const relevant = marks
    .map(mark => ({ ...mark, start: mark.start + markOffset, end: mark.end + markOffset }))
    .filter(mark => mark.end > start && mark.start < end)
  if (relevant.length === 0) return renderTextSegmentWithTags(text)

  const points = new Set<number>([start, end])
  for (const mark of relevant) {
    points.add(Math.max(start, mark.start))
    points.add(Math.min(end, mark.end))
  }
  const ordered = Array.from(points).sort((a, b) => a - b)

  let html = ''
  for (let i = 0; i < ordered.length - 1; i++) {
    const from = ordered[i]
    const to = ordered[i + 1]
    if (to <= from) continue
    const attrs = mergeMarkAttrs(relevant.filter(mark => mark.start <= from && mark.end >= to))
    const piece = renderTextSegmentWithTags(text.slice(from - start, to - start))
    html += attrs ? wrapInlineHtml(piece, attrs) : piece
  }
  return html
}

/** 非文本段整体被格式覆盖时，用格式包裹其结构化 HTML。 */
function wrapSegmentWithMarks(
  html: string,
  start: number,
  end: number,
  marks: InlineMarkRange[] | undefined,
  markOffset: number,
): string {
  if (!marks || marks.length === 0 || end <= start) return html
  const covering = marks
    .map(mark => ({ ...mark, start: mark.start + markOffset, end: mark.end + markOffset }))
    .filter(mark => mark.end > start && mark.start < end)
  const attrs = mergeMarkAttrs(covering)
  return attrs ? wrapInlineHtml(html, attrs) : html
}

/**
 * Render block content to HTML using structured `RenderSegment[]` from Rust.
 *
 * The segments cover `content[start..end]` for every character,
 * with no gaps. We iterate in order: text segments get HTML-escaped
 * (with #tag rendering), typed segments get appropriate `<span>` wrappers.
 *
 * @param input   RenderInput { content, segments, blockId, inlineMarks? } — single object interface
 */
function renderContentToHtml(input: RenderInput): string {
  const { content, segments, blockId = '' } = input
  const marks = input.inlineMarks
  const markOffset = input.markOffset ?? 0
  // 末尾换行落地：pre-wrap 容器里，正文末尾的 `\n` 产生的**空末行盒**按 CSS 规则
  // 零高塌掉 ——「第二行是空行」在渲染态直接消失（编辑态 hardBreak 有行高，两侧不同形）。
  // 补一个零宽空格让末行盒有内容、撑起高度；只补在输出末尾，不碰正文内部断行。
  const trailingBreak = content.endsWith('\n') ? '&#8203;' : ''
  if (!segments || segments.length === 0) {
    // Fallback: no structured data available — use plain escaped text
    return renderTextWithMarks(content, 0, content.length, marks, markOffset) + trailingBreak
  }

  const parts: string[] = []
  for (const seg of segments) {
    switch (seg.type) {
      case 'text': {
        const slice = content.slice(seg.start, seg.end)
        parts.push(renderTextWithMarks(slice, seg.start, seg.end, marks, markOffset))
        break
      }

      case 'link': {
        const target = escapeHtmlEntities(seg.target_page_title)
        const display = escapeHtmlEntities(seg.display_text)
        const html =
          `<span class="${CSS_CLASSES.blockLink}" data-page="${target}">` +
          `<span class="wiki-bracket">[[</span>${display}<span class="wiki-bracket">]]</span>` +
          `</span>`
        parts.push(wrapSegmentWithMarks(html, seg.start, seg.end, marks, markOffset))
        break
      }

      case 'typed_link': {
        const relType = escapeHtmlEntities(seg.relationship_type)
        // 前端转换：type → 中文 label（支持 <-> 双向与 ! auto-inverse）
        const label = escapeHtmlEntities(resolveRelationshipLabel(seg.relationship_type))
        const color = seg.rel_color
        const target = escapeHtmlEntities(seg.target_page_title)
        const display = escapeHtmlEntities(seg.display_text)
        const safeBlockId = escapeHtmlEntities(blockId)

        parts.push(wrapSegmentWithMarks(
          `<span class="relationship-bracket">((<span class="${CSS_CLASSES.relTypeLabel}" ` +
          `data-rel-type="${relType}" ` +
          `data-block-id="${safeBlockId}" ` +
          `data-typed-from="${seg.start}" ` +
          `data-typed-to="${seg.end}" ` +
          `style="--rel-color:${color}">${label}</span>))</span>`
          +
          `<span class="${CSS_CLASSES.blockLink}" data-page="${target}"><span class="wiki-bracket">[[</span>${display}<span class="wiki-bracket">]]</span></span>`,
          seg.start,
          seg.end,
          marks,
          markOffset,
        ))
        break
      }

      case 'external_link': {
        const url = escapeHtmlEntities(seg.url)
        parts.push(wrapSegmentWithMarks(
          `<span class="${CSS_CLASSES.blockLink} external" data-external="${url}">${url}</span>`,
          seg.start,
          seg.end,
          marks,
          markOffset,
        ))
        break
      }

      case 'tag': {
        // ADR-0049 grill 决策 #4：inline `#foo` 结构化 chip。点击无行为（无 data-page，
        // 不接入链接跳转）；is_system 加系统修饰类。text 段的 TAG_TRIGGER_REGEX 兜底
        // 不会重复命中 —— `#foo` 已被 Rust 划入本段，不再是 text。
        const title = escapeHtmlEntities(seg.title)
        // 段原文以 `#` 起头（`#foo`）—— `#` 按字面渲染（与编辑态同形，ADR-0050 D11），
        // 字符留在文本里，偏移换算（render-text 的 tag 段）不受影响
        const rawText = content.slice(seg.start, seg.end)
        const body = escapeHtmlEntities(rawText)
        const systemCls = seg.is_system ? ' block-tag--system' : ''
        const tagId = seg.tag_id ? ` data-tag-id="${escapeHtmlEntities(seg.tag_id)}"` : ''
        // 标签色（ADR-0050 D11）：宿主注入 resolveTagColor 时以实时解析为准（标签改色
        // 即响应，快照只作未就绪兜底）；否则沿用段内快照。空串 / 非法值 → 无内联样式，
        // 落回 `.block-tag` 的默认色（`--color-tag`，即调色板第 1 位）。系统 tag 在
        // Rust 侧拒写颜色，故 `.block-tag--system` 的中性色不会被覆盖。
        const resolved = input.resolveTagColor?.(seg.tag_id, seg.title)
        const color = resolved !== undefined ? resolved : seg.color
        parts.push(wrapSegmentWithMarks(
          `<span class="${CSS_CLASSES.blockTag}${systemCls}"` +
          `${tagId}${tagStyleAttr(color)} data-tag-title="${title}">${body}</span>`,
          seg.start,
          seg.end,
          marks,
          markOffset,
        ))
        break
      }

      case 'date_ref': {
        const kind = escapeHtmlEntities(seg.kind)
        const iso = escapeHtmlEntities(seg.iso)
        const recurrence = escapeHtmlEntities(seg.recurrence)
        // display the original raw syntax
        // seg.start/end 是 Rust 端 byte_to_utf16_idx 返回的 UTF-16 码元索引（emoji 占 2 码元），
        // 必须用 String.prototype.slice 按码元切；Array.from 按 Unicode 码点拆会与码元单位错位，
        // 导致单元内 emoji 之后的字符被多吞/漏吞（曾出现 📅 后跟数字被吞并）。
        const rawDisplay = content.slice(seg.start, seg.end)
        // Rust 段边界含尾随 pad 空白（render_segment_service Step 3 吞空白以满足
        // segments 严格划分）。chip 内只显示非空白部分，尾随空白作为裸文本输出在
        // span 外 —— 否则空白盖进 chip 背景，阅读态比编辑态（装饰止于 emoji）宽
        // 一个空格。data-raw 仍为段原文；点击比对处（useBlockEditorLifecycle）自行 trim。
        const trimmed = rawDisplay.trimEnd()
        const trailingWs = escapeHtmlEntities(rawDisplay.slice(trimmed.length))
        const display = escapeHtmlEntities(rawDisplay)
        const overdue = seg.is_overdue ? 'overdue' : ''
        const classes = [CSS_CLASSES.dateRef, kind, overdue].filter(Boolean).join(' ')

        parts.push(wrapSegmentWithMarks(
          `<span class="${classes}" ` +
          `data-kind="${kind}" ` +
          `data-iso="${iso}" ` +
          `data-recurrence="${recurrence}" ` +
          `data-lead-minutes="${seg.lead_minutes}" ` +
          `data-raw="${display}">${escapeHtmlEntities(trimmed)}</span>${trailingWs}`,
          seg.start,
          seg.end,
          marks,
          markOffset,
        ))
        break
      }
    }
  }

  return parts.join('') + trailingBreak
}

export function useContentRenderer() {
  return { renderContentToHtml }
}
