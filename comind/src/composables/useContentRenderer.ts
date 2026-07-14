import { getPredefinedRelationship } from '../types/relationship'
import {
  DATE_REF_REGEX,
  formatDateRefDisplay,
  parseDateRefs,
  normalizeRecurrence,
  type DateRef,
} from '../utils/date-ref'

const CSS_CLASSES = {
  blockLink: 'block-link',
  relTypeLabel: 'rel-type-label',
  blockTag: 'block-tag',
  dateRef: 'date-ref',
}

const TAG_PATTERN = '([\\p{L}_][\\p{L}\\p{N}_]*(?:\\/[\\p{L}_][\\p{L}\\p{N}_]*)*)'
// 新格式：((type))[[target]] 或 ((type))[[target|alias]]
const TYPED_LINK_REGEX = /\(\(([^)]+)\)\)\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g
const EXTERNAL_LINK_REGEX = /\[\[(https?:\/\/[^\]]+)\]\]/g
// 普通 wiki link：不能匹配已被 typed link 匹配的部分
const WIKI_LINK_REGEX = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g
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

export function useContentRenderer() {
  /**
   * 转义 + 处理 #tag。用于 typed link 之间的纯文本段，
   * 不在最终 HTML 上跑 #tag 正则（避免误匹配 color 值的 #xxxxxx）。
   */
  function renderSegmentWithTags(text: string): string {
    return escapeHtmlEntities(text).replace(TAG_TRIGGER_REGEX, (_, tag) => {
      if (tag.includes('.')) return `#${tag}`
      return `<span class="${CSS_CLASSES.blockLink} ${CSS_CLASSES.blockTag}" data-page="${escapeHtmlEntities(tag)}">#${escapeHtmlEntities(tag)}</span>`
    })
  }

  /**
   * 渲染 dateRef {{kind:ISO|recurrence}} 为可交互 span
   * dateRef 使用 {{...}} 格式，与 typed link `((...))[[...]]` 不冲突，
   * 可在 typed link 之后、wiki link 之前处理。
   */
  function renderDateRefs(text: string): string {
    return text.replace(DATE_REF_REGEX, (full, kind, iso, rec) => {
      const ref: DateRef = {
        kind: kind as DateRef['kind'],
        iso: iso.trim(),
        recurrence: normalizeRecurrence(rec),
      }
      const display = formatDateRefDisplay(ref)
      return `<span class="${CSS_CLASSES.dateRef}" ` +
        `data-kind="${escapeHtmlEntities(kind)}" ` +
        `data-iso="${escapeHtmlEntities(iso.trim())}" ` +
        `data-recurrence="${escapeHtmlEntities(ref.recurrence)}">` +
        `${escapeHtmlEntities(display)}</span>`
    })
  }

  /**
   * 将 Block 内容渲染为 HTML
   *
   * 处理（按顺序）：
   * 1. 带类型链接 ((type))[[X]]：
   *    - 渲染为 `关系类型 [[X]]`
   *    - 段间 #tag 在原始 text 上处理，避免误匹配 style 里的 #xxxxxx 颜色值
   * 2. dateRef {{...}}（在 wiki link 之前，防止 [[...]] 冲突）
   * 3. 外部链接 [[https://...]]
   * 4. 普通链接 [[X]] 或 [[X|alias]] → .block-link
   */
  function renderContentToHtml(text: string, blockId: string = ''): string {
    // 1. 带类型链接 + 段间 #tag（基于原始 text）
    const withTyped = renderTypedLinks(text, blockId)

    // 2. dateRef（基于原始 text，{{...}} 格式与 typed link 不冲突）
    const withDateRefs = renderDateRefs(withTyped)

    // 3. 外部链接（HTML 中无 [[，安全）
    const withExternal = withDateRefs.replace(EXTERNAL_LINK_REGEX, (_, url) => {
      return `<span class="${CSS_CLASSES.blockLink} external" data-external="${escapeHtmlEntities(url)}">${url}</span>`
    })

    // 4. 普通 wiki link（HTML 中无 [[，安全）
    const withWikiLinks = withExternal.replace(WIKI_LINK_REGEX, (_, target, alias) => {
      const display = alias || target
      return `<span class="${CSS_CLASSES.blockLink}" data-page="${escapeHtmlEntities(target)}">${display}</span>`
    })

    return withWikiLinks
  }

  /**
   * 渲染带类型的链接 ((type))[[target]]
   * 新格式：((type))[[target]] 或 ((type))[[target|alias]]
   * 渲染为：关系类型 [[target]]
   *
   * @param text 原始文本内容
   * @param blockId 当前 block 的 ID
   */
  function renderTypedLinks(text: string, blockId: string): string {
    let result = ''
    let lastIndex = 0

    let m: RegExpExecArray | null
    TYPED_LINK_REGEX.lastIndex = 0
    while ((m = TYPED_LINK_REGEX.exec(text)) !== null) {
      const typedStart = m.index
      const typedEnd = m.index + m[0].length
      // 新格式：match[1] = type, match[2] = target, match[3] = alias (可选)
      const relType = m[1]
      const target = m[2]
      const alias = m[3]
      const display = alias || target

      result += renderSegmentWithTags(text.slice(lastIndex, typedStart))

      const rel = getPredefinedRelationship(relType)
      const color = rel?.color ?? '#9CA3AF'
      const chineseLabel = rel?.label ?? relType
      const safeRelType = escapeHtmlEntities(relType)
      const safePage = escapeHtmlEntities(target)
      const safeDisplay = escapeHtmlEntities(display)
      const safeBlockId = escapeHtmlEntities(blockId)
      const safeLabel = escapeHtmlEntities(chineseLabel)

      // 渲染格式：关系类型 [[target]]
      // 直接输出完整的 block-link HTML，避免后续 WIKI_LINK_REGEX 重复处理
      result += `<span class="${CSS_CLASSES.relTypeLabel}" ` +
                `data-rel-type="${safeRelType}" ` +
                `data-block-id="${safeBlockId}" ` +
                `data-typed-from="${typedStart}" ` +
                `data-typed-to="${typedEnd}" ` +
                `data-label-from="${typedStart + 2}" ` +
                `data-label-to="${typedStart + 2 + relType.length}" ` +
                `style="--rel-color:${color}">${safeLabel}</span>` +
                `<span class="${CSS_CLASSES.blockLink}" data-page="${safePage}">${safeDisplay}</span>`

      lastIndex = typedEnd
    }
    result += renderSegmentWithTags(text.slice(lastIndex))
    return result
  }

  return { renderContentToHtml }
}