import type { RenderInput } from '../wasm/types'
import { getRelationshipLabel } from '../types/relationship'
import { parseRelationshipSegment } from '../utils/relationship-content'

const CSS_CLASSES = {
  blockLink: 'block-link',
  relTypeLabel: 'rel-type-label',
  blockTag: 'block-tag',
  dateRef: 'date-ref',
}

const TAG_PATTERN = '([\\p{L}_][\\p{L}\\p{N}_]*(?:\\/[\\p{L}_][\\p{L}\\p{N}_]*)*)'
// 排除 `"`（data-page 属性值内）与 `[`（[[...]] 内），避免 #tag 与 wiki link 互相污染
const TAG_TRIGGER_REGEX = new RegExp(`(?<![\\/|>|@"[])#${TAG_PATTERN}`, 'gu')

/**
 * Wiki link 语法：[[target]] 或 [[target|display]]。
 * 在文本段（fallback / Rust 未生成 link 段）中兜底渲染，
 * 输出与结构化 Link segment 相同的 .block-link 结构，保证样式与点击行为一致。
 */
const WIKI_LINK_REGEX = /\[\[([^\[\]]+?)(?:\|([^\[\]]+?))?\]\]/g

function escapeHtmlEntities(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 从 relationship_type（可能含 <-> / ! 修饰符）解析出中文 label。
 * 兼容三种语法：
 *   ((type))            → getRelationshipLabel(type)
 *   ((type<->inverse))  → label<->inverseLabel
 *   ((type!))           → label!
 * 未知类型回退显示原文（与 Rust rel_cache 行为一致）。
 */
function resolveRelationshipLabel(relType: string): string {
  const parts = parseRelationshipSegment(relType)
  const label = getRelationshipLabel(parts.type)
  if (parts.inverse !== undefined) {
    const invLabel = getRelationshipLabel(parts.inverse)
    // 未知反向类型时回退原文，避免半转换
    if (invLabel === parts.inverse) return relType
    return `${label}<->${invLabel}`
  }
  if (parts.autoInverse) {
    // 未知正向类型时回退原文
    if (label === parts.type) return relType
    return `${label}!`
  }
  // 未知类型回退原文
  return label === parts.type ? relType : label
}

export interface HeadingParseResult {
  level: number
  title: string
}

export function parseHeading(text: string): HeadingParseResult | null {
  const match = text.match(/^(#{1,6})\s+(.+)$/)
  if (match) {
    return { level: match[1].length, title: match[2] }
  }
  return null
}

/**
 * Escape HTML entities and render #tag patterns + [[wiki links]] within a plain-text segment.
 * Applied only on the original text slice, not on already-rendered HTML,
 * so color hex values won't be accidentally matched.
 *
 * [[...]] 兜底：Rust 的 render_segments 基于 DB links 表构建，当 links 表缺少记录时
 * （旧数据/导入数据），[[target]] 会落入 text 段。此处按结构化 Link segment
 * 的同一 HTML 结构渲染，保证链接样式与点击跳转一致。
 */
function renderTextSegmentWithTags(text: string): string {
  return escapeHtmlEntities(text)
    // 先解析 wiki link：生成的 span 含 `#tag` 时由后续 tag 正则的排除集（`"`/`>`）保护，
    // 避免嵌套替换损坏 HTML
    .replace(WIKI_LINK_REGEX, (_, target: string, display?: string) => {
      // 输入已是 escapeHtmlEntities 后的文本，捕获的 target/display 无需再次转义
      const page = target
      const shown = display ?? target
      return `<span class="${CSS_CLASSES.blockLink}" data-page="${page}">` +
        `<span class="wiki-bracket">[[</span>${shown}<span class="wiki-bracket">]]</span></span>`
    })
    .replace(TAG_TRIGGER_REGEX, (_, tag) => {
      if (tag.includes('.')) return `#${tag}`
      return `<span class="${CSS_CLASSES.blockLink} ${CSS_CLASSES.blockTag}" data-page="${escapeHtmlEntities(tag)}">#${escapeHtmlEntities(tag)}</span>`
    })
}

/**
 * Render block content to HTML using structured `RenderSegment[]` from Rust.
 *
 * The segments cover `content[start..end]` for every character,
 * with no gaps. We iterate in order: text segments get HTML-escaped
 * (with #tag rendering), typed segments get appropriate `<span>` wrappers.
 *
 * @param input   RenderInput { content, segments, blockId } — single object interface
 */
function renderContentToHtml(input: RenderInput): string {
  const { content, segments, blockId = '' } = input
  if (!segments || segments.length === 0) {
    // Fallback: no structured data available — use plain escaped text
    return renderTextSegmentWithTags(content)
  }

  const parts: string[] = []
  for (const seg of segments) {
    switch (seg.type) {
      case 'text': {
        const slice = content.slice(seg.start, seg.end)
        parts.push(renderTextSegmentWithTags(slice))
        break
      }

      case 'link': {
        const target = escapeHtmlEntities(seg.target_page_title)
        const display = escapeHtmlEntities(seg.display_text)
        parts.push(
          `<span class="${CSS_CLASSES.blockLink}" data-page="${target}">` +
          `<span class="wiki-bracket">[[</span>${display}<span class="wiki-bracket">]]</span>` +
          `</span>`
        )
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

        parts.push(
          `<span class="relationship-bracket">((<span class="${CSS_CLASSES.relTypeLabel}" ` +
          `data-rel-type="${relType}" ` +
          `data-block-id="${safeBlockId}" ` +
          `data-typed-from="${seg.start}" ` +
          `data-typed-to="${seg.end}" ` +
          `style="--rel-color:${color}">${label}</span>))</span>`
          +
          `<span class="${CSS_CLASSES.blockLink}" data-page="${target}"><span class="wiki-bracket">[[</span>${display}<span class="wiki-bracket">]]</span></span>`
        )
        break
      }

      case 'external_link': {
        const url = escapeHtmlEntities(seg.url)
        parts.push(
          `<span class="${CSS_CLASSES.blockLink} external" data-external="${url}">${url}</span>`
        )
        break
      }

      case 'date_ref': {
        const kind = escapeHtmlEntities(seg.kind)
        const iso = escapeHtmlEntities(seg.iso)
        const recurrence = escapeHtmlEntities(seg.recurrence)
        // display the original raw syntax
        const chars = Array.from(content);
        // seg.start、seg.end 这里注意：这里的seg.start/end是【字符索引】，不是原码元索引！
        const rawDisplay = chars.slice(seg.start, seg.end).join('');
        const display = escapeHtmlEntities(rawDisplay)
        const overdue = seg.is_overdue ? 'overdue' : ''
        const classes = [CSS_CLASSES.dateRef, kind, overdue].filter(Boolean).join(' ')

        parts.push(
          `<span class="${classes}" ` +
          `data-kind="${kind}" ` +
          `data-iso="${iso}" ` +
          `data-recurrence="${recurrence}" ` +
          `data-lead-minutes="${seg.lead_minutes}" ` +
          `data-raw="${display}">${display}</span>`
        )
        break
      }
    }
  }

  return parts.join('')
}

export function useContentRenderer() {
  return { renderContentToHtml }
}
