import { getPredefinedRelationship } from '../types/relationship'

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
  relationshipType: string | null
  inverseRelationshipType: string | null
}

/**
 * 解析关系类型部分
 * 支持格式：
 * - "depends-on" → { type: "depends-on", inverse: null }
 * - "depends-on<->required-by" → { type: "depends-on", inverse: "required-by" }
 * - "depends-on!" → { type: "depends-on", inverse: "auto" }
 */
function parseRelationshipPart(part: string): {
  relationshipType: string | null
  inverseRelationshipType: string | null
} {
  const trimmed = part.trim()

  // 格式 1: "depends-on<->required-by"（双向指定）
  const bidirectionalMatch = trimmed.match(/^(.+)<->(.+)$/)
  if (bidirectionalMatch) {
    return {
      relationshipType: bidirectionalMatch[1].trim(),
      inverseRelationshipType: bidirectionalMatch[2].trim(),
    }
  }

  // 格式 2: "depends-on!"（自动使用预定义反向）
  const autoInverseMatch = trimmed.match(/^(.+)!$/)
  if (autoInverseMatch) {
    const type = autoInverseMatch[1].trim()
    const predefined = getPredefinedRelationship(type)
    return {
      relationshipType: type,
      inverseRelationshipType: predefined?.inverse || null,
    }
  }

  // 格式 3: "depends-on"（单向）
  return {
    relationshipType: trimmed,
    inverseRelationshipType: null,
  }
}

/**
 * 解析 [[链接]]
 * 支持 [[页面名]] 和 [[页面名|别名]]
 * 支持 ((关系类型))[[页面名]] 和 ((关系类型))[[页面名|别名]]
 * 外部链接识别：http:// https:// ftp:// mailto://
 */
function extractLinkMatches(content: string): Array<{ match: RegExpExecArray; isExternal: boolean }> {
  const results: Array<{ match: RegExpExecArray; isExternal: boolean }> = []

  // 外部链接 [[http://...]]
  const externalRegex = /\[\[(https?:\/\/|ftp:\/\/|mailto:)([^\]]*)\]\]/gi
  let match: RegExpExecArray | null
  while ((match = externalRegex.exec(content)) !== null) {
    results.push({ match, isExternal: true })
  }

  // 带关系类型的内部链接 ((关系类型))[[页面名|别名]] 或 ((关系类型))[[页面名]]
  // 必须在普通链接之前匹配，避免重复
  // 新格式：((type))[[target|alias]] 或 ((type))[[target]]
  const relationshipRegex = /\(\(([^)]+)\)\)\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/gi
  while ((match = relationshipRegex.exec(content)) !== null) {
    // match[1] = 关系类型, match[2] = target, match[3] = alias (可选)
    const target = match[2]
    if (/^(https?:\/\/|ftp:\/\/|mailto:)/i.test(target)) continue
    results.push({ match, isExternal: false })
  }

  // 普通内部链接 [[页面名]] 或 [[页面名|别名]]
  const internalRegex = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/gi
  while ((match = internalRegex.exec(content)) !== null) {
    // 排除已匹配为外部链接的情况（通过检查是否以 http/https/ftp/mailto 开头）
    const target = match[1]
    if (/^(https?:\/\/|ftp:\/\/|mailto:)/i.test(target)) continue
    // 检查是否已被关系类型链接匹配（通过位置范围）
    // 新格式 ((type))[[target]] 中，[[target]] 的位置在 ((type)) 之后
    // 需要检查当前 match 的范围是否被任何已匹配结果的范围包含
    const matchStart = match.index
    const matchEnd = match.index + match[0].length
    const alreadyMatched = results.some(r => {
      const rStart = r.match.index
      const rEnd = rStart + r.match[0].length
      return matchStart >= rStart && matchEnd <= rEnd
    })
    if (alreadyMatched) continue
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
      let target: string
      let display: string
      let relationshipType: string | null = null
      let inverseRelationshipType: string | null = null

      if (isExternal) {
        // 外部链接：协议 + 剩余部分
        target = (match[1] + (match[2] || '')).trim()
        display = target
      } else {
        // 检查是否是带关系类型的链接：匹配字符串以 (( 开头
        // 新格式：((type))[[target|alias]]
        if (match[0].startsWith('((')) {
          // 带关系类型：((关系类型))[[页面名|别名]] 或 ((关系类型))[[页面名]]
          // match[1] = 关系类型, match[2] = target, match[3] = alias (可选)
          const parsed = parseRelationshipPart(match[1])
          relationshipType = parsed.relationshipType
          inverseRelationshipType = parsed.inverseRelationshipType
          target = match[2].trim()
          display = (match[3] || target).trim()
        } else {
          // 普通链接：[[页面名]] 或 [[页面名|别名]]
          target = match[1].trim()
          display = (match[2] || target).trim()
        }
      }

      return {
        targetTitle: target,
        displayText: display,
        position: match.index,
        isExternal,
        relationshipType,
        inverseRelationshipType,
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
