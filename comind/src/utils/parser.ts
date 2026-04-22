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

/** 标签正则核心模式：# 后紧跟 Unicode 字母或 _，支持层级标签（斜杠分隔） */
const TAG_PATTERN = '([\\p{L}_][\\p{L}\\p{N}_]*(?:\\/[\\p{L}_][\\p{L}\\p{N}_]*)*)'

/**
 * 标签正则（单一来源，供 parser.ts 和 Block.vue 共用）
 *
 * 排除策略（双层）：
 * 1. 正则层：单字符 lookbehind 排除 |/>|@ 紧邻 # 的情况
 * 2. 代码层：isTagInUrlContext() 检查 # 前方是否有 :// 或 @ 模式
 *
 * 正则无法用 lookbehind 排除 ://（3 字符变长），
 * 因此 URL 锚点由代码层 isTagInUrlContext() 过滤。
 */
export const TAG_REGEX = new RegExp(`(?<![\\/|>|@])#${TAG_PATTERN}`, 'gu')

/**
 * 检查标签匹配是否在 URL / 邮箱上下文中（应排除）
 *
 * 识别：
 * - ://xxx#xxx → URL 锚点（如 https://x.com#section）
 * - @xxx#xxx → 邮箱锚点（如 user@domain#tag）
 * - x:#xxx → 协议后锚点（如 mailto:#tag）
 */
function isTagInUrlContext(content: string, hashIndex: number): boolean {
  const lookback = content.slice(Math.max(0, hashIndex - 50), hashIndex)
  if (/:\/\/[^#\s]*$/.test(lookback)) return true
  if (/@[^#\s]*$/.test(lookback)) return true
  if (hashIndex > 0 && content[hashIndex - 1] === ':') return true
  return false
}

/** 属性 key 正则：支持 Unicode 字母开头（中文 key 如「作者::」「状态::」） */
const PROP_KEY_REGEX = /^([\p{L}_][\p{L}\p{N}_]*)::\s*(.+)$/gmu

export function parseContent(content: string): ParseResult {
  const links: LinkParse[] = parseBlockLinks(content)

  const tags: string[] = []
  // 克隆正则避免 lastIndex 污染
  const tagRegex = new RegExp(TAG_REGEX.source, 'gu')
  let match
  while ((match = tagRegex.exec(content)) !== null) {
    const tag = match[1]
    // 排除含 . 的标签（如版本号 #v2.0）和 URL/邮箱上下文
    if (tag.includes('.')) continue
    if (isTagInUrlContext(content, match.index)) continue
    tags.push(tag)
  }

  // 解析属性（key:: value）
  const properties: Record<string, any> = {}
  const propRegex = new RegExp(PROP_KEY_REGEX.source, 'gmu')
  while ((match = propRegex.exec(content)) !== null) {
    properties[match[1]] = parsePropertyValue(match[2])
  }

  return { links, tags, properties }
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
