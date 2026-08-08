import type { RenderSegment } from '../wasm/types'

const CSS_CLASSES = {
  blockLink: 'block-link',
  relTypeLabel: 'rel-type-label',
  blockTag: 'block-tag',
  dateRef: 'date-ref',
}

const TAG_PATTERN = '([\\p{L}_][\\p{L}\\p{N}_]*(?:\\/[\\p{L}_][\\p{L}\\p{N}_]*)*)'
const TAG_TRIGGER_REGEX = new RegExp(`(?<![\\/|>|@])#${TAG_PATTERN}`, 'gu')

function escapeHtmlEntities(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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
 * Escape HTML entities and render #tag patterns within a plain-text segment.
 * Applied only on the original text slice, not on already-rendered HTML,
 * so color hex values won't be accidentally matched.
 */
function renderTextSegmentWithTags(text: string): string {
  return escapeHtmlEntities(text).replace(TAG_TRIGGER_REGEX, (_, tag) => {
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
 * @param segments  Pre-computed render instructions from Rust (via `getPageWithBlocks`)
 * @param content   The raw block.content string
 * @param blockId   Optional block ID for data attributes (used by TypedLink)
 */
function renderContentToHtml(segments: RenderSegment[], content: string, blockId: string = ''): string {
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
        const label = escapeHtmlEntities(seg.rel_label)
        const color = seg.rel_color
        const target = escapeHtmlEntities(seg.target_page_title)
        const display = escapeHtmlEntities(seg.display_text)
        const safeBlockId = escapeHtmlEntities(blockId)

        parts.push(
          `<span class="${CSS_CLASSES.relTypeLabel}" ` +
          `data-rel-type="${relType}" ` +
          `data-block-id="${safeBlockId}" ` +
          `data-typed-from="${seg.start}" ` +
          `data-typed-to="${seg.end}" ` +
          `style="--rel-color:${color}">${label}</span>` +
          `<span class="${CSS_CLASSES.blockLink}" data-page="${target}">${display}</span>`
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
        const rawDisplay = content.slice(seg.start, seg.end)
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
