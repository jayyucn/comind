// 解析结果类型定义
export interface ParseResult {
  links: LinkParse[]
  tags: string[]
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
        isExternal
      } satisfies LinkParse
    })
    .filter((item, index, arr) => arr.findIndex(i => i.position === item.position) === index)
    .sort((a, b) => a.position - b.position)

  return sorted
}

/** 标签正则（单一来源，供 parser.ts 和 Block.vue 共用）
 *  规则：# 后紧跟 Unicode 字母或 _，不能以数字开头
 *  支持层级标签 #工作/项目A（斜杠分隔多级）
 *  排除：URL 锚点（://#）、邮箱锚点（>#、|#、@#）、含 . 的（域名）
 */
export const TAG_REGEX = /(?<![:\/>|@])#([\p{L}_][\p{L}\p{N}_]*(?:\/[\p{L}_][\p{L}\p{N}_]*)*)/gu

/** 属性 key 正则：支持 Unicode 字母开头（中文 key 如「作者::」「状态::」） */
const PROP_KEY_REGEX = /^([\p{L}_][\p{L}\p{N}_]*)::\s*(.+)$/gm

export function parseContent(content: string): ParseResult {
  const links: LinkParse[] = parseBlockLinks(content)

  const tags: string[] = []
  let match
  while ((match = TAG_REGEX.exec(content)) !== null) {
    const tag = match[1]
    if (!tag.includes('.')) {
      tags.push(tag)
    }
  }

  // 解析属性（key:: value）
  const properties: Record<string, any> = {}
  while ((match = PROP_KEY_REGEX.exec(content)) !== null) {
    properties[match[1]] = parsePropertyValue(match[2])
  }

  return { links, tags, properties }
}

/**
 * 属性值类型推断
 */
export function parsePropertyValue(value: string): any {
  const trimmed = value.trim()

  if (trimmed === 'true') return true
  if (trimmed === 'false') return false

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed

  if (/^\d+\.?\d*$/.test(trimmed)) return Number(trimmed)

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).split(',').map(s => s.trim())
  }

  const pageMatch = trimmed.match(/^\[\[([^\]]+)\]\]$/)
  if (pageMatch) return pageMatch[1]

  return trimmed
}
