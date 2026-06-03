import { getPredefinedRelationship } from '../types/relationship'

const CSS_CLASSES = {
  blockLink: 'block-link',
  blockLinkTyped: 'block-link-typed',
  relTypeLabel: 'rel-type-label',
  blockTag: 'block-tag'
}

const TAG_PATTERN = '([\\p{L}_][\\p{L}\\p{N}_]*(?:\\/[\\p{L}_][\\p{L}\\p{N}_]*)*)'
const TYPED_LINK_REGEX = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]\^?\(([^)]+)\)/g
const EXTERNAL_LINK_REGEX = /\[\[(https?:\/\/[^\]]+)\]\]/g
const WIKI_LINK_REGEX = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g
const TAG_TRIGGER_REGEX = new RegExp(`(?<![\\/|>|@])#${TAG_PATTERN}`, 'gu')

function escapeHtmlEntities(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function useContentRenderer() {
  /**
   * 将 Block 内容渲染为 HTML
   *
   * 处理（按顺序）：
   * 1. 带类型链接 [[X]]^(type) → .block-link-typed + .rel-type-label
   *    （在原始 text 上做字符偏移，保证 data-typed-from/to 是原文偏移）
   * 2. 外部链接 [[https://...]]
   * 3. 普通链接 [[X]] 或 [[X|alias]] → .block-link
   * 4. #tag → .block-link.block-tag
   */
  function renderContentToHtml(text: string, blockId: string = ''): string {
    // 1. 带类型链接（必须在外部/普通链接之前 — 它的语法里也含 `[[...]]`）
    const withTyped = renderTypedLinks(text, blockId)

    // 2. 外部链接
    const withExternal = withTyped.replace(EXTERNAL_LINK_REGEX, (_, url) => {
      return `<span class="${CSS_CLASSES.blockLink} external" data-external="${escapeHtmlEntities(url)}">${url}</span>`
    })

    // 3. 普通 wiki link（typed 链接已变成 span，外部链接也已 span，剩下的是普通 wiki link）
    const withWikiLinks = withExternal.replace(WIKI_LINK_REGEX, (_, target, alias) => {
      const display = alias || target
      return `<span class="${CSS_CLASSES.blockLink}" data-page="${escapeHtmlEntities(target)}">${display}</span>`
    })

    // 4. #tag
    const final = withWikiLinks.replace(TAG_TRIGGER_REGEX, (_, tag) => {
      if (tag.includes('.')) return `#${tag}`
      return `<span class="${CSS_CLASSES.blockLink} ${CSS_CLASSES.blockTag}" data-page="${escapeHtmlEntities(tag)}">#${escapeHtmlEntities(tag)}</span>`
    })

    return final
  }

  function renderTypedLinks(text: string, blockId: string): string {
    let result = ''
    let lastIndex = 0

    let m: RegExpExecArray | null
    TYPED_LINK_REGEX.lastIndex = 0
    while ((m = TYPED_LINK_REGEX.exec(text)) !== null) {
      const typedStart = m.index
      const typedEnd = m.index + m[0].length
      const target = m[1]
      const alias = m[2]
      const relType = m[3]
      const display = alias || target

      // append 上一段（已转义）
      result += escapeHtmlEntities(text.slice(lastIndex, typedStart))

      const rel = getPredefinedRelationship(relType)
      const color = rel?.color ?? '#9CA3AF'
      const safeRelType = escapeHtmlEntities(relType)
      const safePage = escapeHtmlEntities(target)
      const safeDisplay = escapeHtmlEntities(display)
      const safeBlockId = escapeHtmlEntities(blockId)

      // label 范围覆盖 `^(type)` 中的 `(type)`（含开括号和闭括号）
      // 例如 [[X]]^(depends-on) 中 `(depends-on)` 起始于 typedEnd - relType.length - 1
      result += `<span class="${CSS_CLASSES.blockLinkTyped}" ` +
                `data-page="${safePage}" ` +
                `data-rel-type="${safeRelType}" ` +
                `data-block-id="${safeBlockId}" ` +
                `data-typed-from="${typedStart}" ` +
                `data-typed-to="${typedEnd}" ` +
                `style="--rel-color:${color}">${safeDisplay}</span>` +
                `<span class="${CSS_CLASSES.relTypeLabel}" ` +
                `data-rel-type="${safeRelType}" ` +
                `data-block-id="${safeBlockId}" ` +
                `data-label-from="${typedEnd - relType.length - 1}" ` +
                `data-label-to="${typedEnd}" ` +
                `style="--rel-color:${color}">${safeRelType}</span>`

      lastIndex = typedEnd
    }
    result += escapeHtmlEntities(text.slice(lastIndex))
    return result
  }

  return { renderContentToHtml }
}
