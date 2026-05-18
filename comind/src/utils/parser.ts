// 解析结果类型定义
export interface ParseResult {
  links: LinkParse[]
  properties: Record<string, any>
}

export interface LinkParse {
  targetTitle: string
  displayText: string
  position: number
  isExternal: boolean
}

/**
 * 解析 [[链接]]
 * 支持 [[页面名]] 和 [[页面名|别名]]
 * 外部链接识别：http:// https:// ftp:// mailto://
 */
function extractLinkMatches(content: string): Array<{ match: RegExpExecArray; isExternal: boolean }> {
  const results: Array<{ match: RegExpExecArray; isExternal: boolean }> = []

  // 外部链接 [[http://...]]
  const externalRegex = /\[\[(https?:\/\/|ftp:\/\/|mailto:)([^\]]+)\]\]/gi
  let match
  while ((match = externalRegex.exec(content)) !== null) {
    results.push({ match, isExternal: true })
  }

  // 内部链接 [[页面名]] 或 [[页面名|别名]]
  const internalRegex = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/gi
  while ((match = internalRegex.exec(content)) !== null) {
    // 排除已匹配为外部链接的情况（通过检查是否以 http/https/ftp/mailto 开头）
    const target = match[1]
    if (/^(https?:\/\/|ftp:\/\/|mailto:)/i.test(target)) continue
    results.push({ match, isExternal: false })
  }

  return results
}

/**
 * 解析内容中的 [[链接]]
 * 返回 LinkParse[]（供 IndexedDB 写入 Link 表）
 */
export function parseBlockLinks(content: string): LinkParse[] {
  const linkMatches = extractLinkMatches(content)

  // 按 position 排序后去重
  const sorted = linkMatches
    .map(({ match, isExternal }) => {
      const target = match[1].trim()
      const display = (match[2] || target).trim()
      return {
        targetTitle: target,
        displayText: display,
        position: match.index,
        isExternal,
      } satisfies LinkParse
    })
    .filter((item, index, arr) => arr.findIndex(i => i.position === item.position) === index)
    .sort((a, b) => a.position - b.position)

  return sorted
}

/** 属性 key 正则：支持 Unicode 字母开头（中文 key 如「作者::」「状态::」） */
const PROP_KEY_REGEX = /^([\p{L}_][\p{L}\p{N}_]*)::\s*(.+)$/gmu

/**
 * 解析内容中的 [[链接]] 和属性
 *
 * #tag 不再作为独立的 tag 解析
 * 现在由 useContentRenderer 将 #tag 渲染为 Page 链接
 */
export function parseContent(content: string): ParseResult {
  const links: LinkParse[] = parseBlockLinks(content)

  // 解析属性（key:: value）
  const properties: Record<string, any> = {}
  const propRegex = new RegExp(PROP_KEY_REGEX.source, 'gmu')
  let match
  while ((match = propRegex.exec(content)) !== null) {
    properties[match[1]] = parsePropertyValue(match[2])
  }

  return { links, properties }
}

/**
 * 属性值类型推断
 *
 * 推断优先级：
 * 1. boolean（true / false）
 * 2. date（YYYY-MM-DD）
 * 3. page reference（[[页面名]]）— 必须在 list 之前检查
 * 4. number（整数或小数）
 * 5. list（[a, b, c]）
 * 6. string（默认）
 */
export function parsePropertyValue(value: string): any {
  const trimmed = value.trim()

  if (trimmed === 'true') return true
  if (trimmed === 'false') return false

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed

  // page reference 必须在 list 之前检查（因为 [[张三]] 同时满足 startsWith('[')）
  const pageMatch = trimmed.match(/^\[\[([^\]]+)\]\]$/)
  if (pageMatch) return pageMatch[1]

  if (/^\d+\.?\d*$/.test(trimmed)) return Number(trimmed)

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).split(',').map(s => s.trim())
  }

  return trimmed
}
