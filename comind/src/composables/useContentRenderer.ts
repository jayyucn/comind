import { getPredefinedRelationship } from '../types/relationship'

const CSS_CLASSES = {
  blockLink: 'block-link',
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
   * 将 Block 内容渲染为 HTML
   *
   * 处理（按顺序）：
   * 1. 带类型链接 [[X]]^(type)：
   *    - [[X]] 部分渲染为普通 .block-link（保持原样）
   *    - ^(type) 部分渲染为 .rel-type-label，显示 `^中文label`，颜色用关系色
   *    段间 #tag 在原始 text 上处理，避免误匹配 style 里的 #xxxxxx 颜色值
   * 2. 外部链接 [[https://...]]
   * 3. 普通链接 [[X]] 或 [[X|alias]] → .block-link
   */
  function renderContentToHtml(text: string, blockId: string = ''): string {
    // 1. 带类型链接 + 段间 #tag（基于原始 text）
    const withTyped = renderTypedLinks(text, blockId)

    // 2. 外部链接（HTML 中无 [[，安全）
    const withExternal = withTyped.replace(EXTERNAL_LINK_REGEX, (_, url) => {
      return `<span class="${CSS_CLASSES.blockLink} external" data-external="${escapeHtmlEntities(url)}">${url}</span>`
    })

    // 3. 普通 wiki link（HTML 中无 [[，安全）
    const withWikiLinks = withExternal.replace(WIKI_LINK_REGEX, (_, target, alias) => {
      const display = alias || target
      return `<span class="${CSS_CLASSES.blockLink}" data-page="${escapeHtmlEntities(target)}">${display}</span>`
    })

    return withWikiLinks
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

      // 段间纯文本（原始 text），在 escape 后做 #tag 处理
      result += renderSegmentWithTags(text.slice(lastIndex, typedStart))

      const rel = getPredefinedRelationship(relType)
      const color = rel?.color ?? '#9CA3AF'
      const chineseLabel = rel?.label ?? relType
      const safeRelType = escapeHtmlEntities(relType)
      const safePage = escapeHtmlEntities(target)
      const safeDisplay = escapeHtmlEntities(display)
      const safeBlockId = escapeHtmlEntities(blockId)
      const safeLabel = escapeHtmlEntities(chineseLabel)

      // [[X]] 部分：普通 block-link（保持原样，无关系样式）
      result += `<span class="${CSS_CLASSES.blockLink}" data-page="${safePage}">${safeDisplay}</span>`

      // ^(type) 部分：rel-type-label（关系色、小号字体）
      // 携带 typed 范围（用于点击时替换整段）和 label 范围（仅关系部分）
      // 标签显示 `^中文label`（caret + 中文 label）
      // label-to = typedEnd - 1 排除 typed link 末尾的 ')'：
      //   typed link = `[[X]]^(type)`，rel type 在 typedEnd - relType.length - 1 到 typedEnd - 2 之间
      //   如果用 typedEnd（含 ')'），点击替换会吃掉 ')'，导致下一次切换继续丢字符
      result += `<span class="${CSS_CLASSES.relTypeLabel}" ` +
                `data-rel-type="${safeRelType}" ` +
                `data-block-id="${safeBlockId}" ` +
                `data-typed-from="${typedStart}" ` +
                `data-typed-to="${typedEnd}" ` +
                `data-label-from="${typedEnd - relType.length - 1}" ` +
                `data-label-to="${typedEnd - 1}" ` +
                `style="--rel-color:${color}">^${safeLabel}</span>`

      lastIndex = typedEnd
    }
    result += renderSegmentWithTags(text.slice(lastIndex))
    return result
  }

  return { renderContentToHtml }
}
