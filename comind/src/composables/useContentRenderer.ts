const CSS_CLASSES = {
  blockLink: 'block-link',
  blockTag: 'block-tag',
  tagSegment: 'tag-segment',
  tagSep: 'tag-sep'
}

/**
 * #tag 正则模式
 * 
 * 匹配规则：
 * - # 后紧跟 Unicode 字母或 _（支持中文/日文等多语言）
 * - 支持层级标签（斜杠分隔），如 #项目/子项目
 * - 排除数字开头（#123 不匹配）
 * - 排除 URL/邮箱上下文（由渲染层处理）
 */
const TAG_PATTERN = '([\\p{L}_][\\p{L}\\p{N}_]*(?:\\/[\\p{L}_][\\p{L}\\p{N}_]*)*)'
const TAG_REGEX = new RegExp(`(?<![\\/|>|@])#${TAG_PATTERN}`, 'gu')

export function useContentRenderer() {
  function escapeHtmlEntities(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  /**
   * 将 Block 内容渲染为 HTML
   * 
   * 处理：
   * 1. [[WikiLink]] → <span class="block-link" data-page="...">
   * 2. #tag → <span class="block-link block-tag" data-page="...">（作为 Page 链接）
   */
  function renderContentToHtml(text: string): string {
    const html = escapeHtmlEntities(text)
    return html
      // 外部链接 [[https://...]]
      .replace(/\[\[(https?:\/\/[^\]]+)\]\]/g, (_, url) => {
        return `<span class="${CSS_CLASSES.blockLink} external" data-external="${escapeHtmlEntities(url)}">${url}</span>`
      })
      // 内部链接 [[页面名]] 或 [[页面名|别名]]
      .replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_, target, alias) => {
        const display = alias || target
        return `<span class="${CSS_CLASSES.blockLink}" data-page="${escapeHtmlEntities(target)}">${display}</span>`
      })
      // #tag → 渲染为 Page 链接
      .replace(TAG_REGEX, (_, tag) => {
        // 排除版本号等含 . 的情况
        if (tag.includes('.')) return `#${tag}`
        // 渲染为 Page 链接（data-page 指向 Page 名）
        return `<span class="${CSS_CLASSES.blockLink} ${CSS_CLASSES.blockTag}" data-page="${escapeHtmlEntities(tag)}">#${escapeHtmlEntities(tag)}</span>`
      })
  }

  return { renderContentToHtml }
}
