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

// 预定义关系类型
export const PREDEFINED_RELATIONSHIPS = [
  { key: 'parent', inverseKey: 'child', label: '父级', inverseLabel: '子级', color: '#4CAF50' },
  { key: 'child', inverseKey: 'parent', label: '子级', inverseLabel: '父级', color: '#8BC34A' },
  { key: 'related', inverseKey: 'related', label: '相关', inverseLabel: '相关', color: '#607D8B' },
  { key: 'depends-on', inverseKey: 'required-by', label: '依赖', inverseLabel: '被依赖', color: '#FF9800' },
  { key: 'required-by', inverseKey: 'depends-on', label: '被依赖', inverseLabel: '依赖', color: '#FFC107' },
  { key: 'references', inverseKey: 'referenced-by', label: '引用', inverseLabel: '被引用', color: '#2196F3' },
  { key: 'referenced-by', inverseKey: 'references', label: '被引用', inverseLabel: '引用', color: '#03A9F4' },
  { key: 'example-of', inverseKey: 'has-example', label: '示例', inverseLabel: '拥有示例', color: '#9C27B0' },
  { key: 'has-example', inverseKey: 'example-of', label: '拥有示例', inverseLabel: '示例', color: '#E91E63' },
]

// 获取关系类型配置（返回预定义配置或默认配置）
export function getRelationshipConfig(key: string | null) {
  if (!key) {
    return { key: null, label: '关联', color: '#9E9E9E' }
  }
  const config = PREDEFINED_RELATIONSHIPS.find(r => r.key === key)
  if (config) {
    return { key: config.key, label: config.label, color: config.color }
  }
  // 自定义关系类型的默认配置
  return { key, label: key, color: '#9E9E9E' }
}

/**
 * 解析 [[链接]]
 * 支持 [[页面名]]、[[页面名|别名]]、[[页面名]]^(关系类型)、[[页面名|别名]]^(关系类型)
 * 外部链接识别：http:// https:// ftp:// mailto://
 */
function extractLinkMatches(content: string): Array<{ match: RegExpExecArray; isExternal: boolean; position: number }> {
  const results: Array<{ match: RegExpExecArray; isExternal: boolean; position: number }> = []

  // 外部链接 [[http://...]]
  const externalRegex = /\[\[(https?:\/\/|ftp:\/\/|mailto:)([^\]]*)\]\]/gi
  let match: RegExpExecArray | null
  while ((match = externalRegex.exec(content)) !== null) {
    results.push({ match, isExternal: true, position: match.index })
  }

  // 内部链接带关系类型 [[页面名]]^(关系类型) 或 [[页面名|别名]]^(关系类型)
  const internalWithRelRegex = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]\^\(([^)]+)\)/gi
  while ((match = internalWithRelRegex.exec(content)) !== null) {
    const target = match[1]
    if (/^(https?:\/\/|ftp:\/\/|mailto:)/i.test(target)) continue
    results.push({ match, isExternal: false, position: match.index })
  }

  // 普通内部链接 [[页面名]] 或 [[页面名|别名]]
  const internalRegex = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/gi
  while ((match = internalRegex.exec(content)) !== null) {
    // 检查是否已被关系类型链接匹配（因为两个正则可能重叠）
    const alreadyMatched = results.some(r => r.position === match!.index)
    if (alreadyMatched) continue
    const target = match[1]
    if (/^(https?:\/\/|ftp:\/\/|mailto:)/i.test(target)) continue
    results.push({ match, isExternal: false, position: match.index })
  }

  return results
}

/**
 * 解析关系类型部分
 * 支持：
 * - "depends-on" → { type: "depends-on", inverse: null }
 * - "depends-on<->required-by" → { type: "depends-on", inverse: "required-by" }
 * - "depends-on!" → { type: "depends-on", inverse: "auto" }
 */
function parseRelationshipPart(part: string): {
  relationshipType: string | null
  inverseRelationshipType: string | null
} {
  // 格式 1: "depends-on<->required-by"
  const bidirectionalMatch = part.match(/^([^<]+)<->(.+)$/)
  if (bidirectionalMatch) {
    return {
      relationshipType: bidirectionalMatch[1].trim(),
      inverseRelationshipType: bidirectionalMatch[2].trim(),
    }
  }

  // 格式 2: "depends-on!"（自动使用预定义反向）
  const autoInverseMatch = part.match(/^(.+)!$/)
  if (autoInverseMatch) {
    const type = autoInverseMatch[1].trim()
    const predefined = PREDEFINED_RELATIONSHIPS.find(r => r.key === type)
    return {
      relationshipType: type,
      inverseRelationshipType: predefined?.inverseKey || null,
    }
  }

  // 格式 3: "depends-on"（单向）
  return {
    relationshipType: part.trim(),
    inverseRelationshipType: null,
  }
}

/**
 * 解析内容中的 [[链接]]
 * 返回 LinkParse[]（供 IndexedDB 写入 Link 表）
 */
export function parseBlockLinks(content: string): LinkParse[] {
  const linkMatches = extractLinkMatches(content)

  // 按 position 排序后去重
  const sorted = linkMatches
    .map(({ match, isExternal, position }) => {
      let target: string
      let display: string
      let relationshipType: string | null = null
      let inverseRelationshipType: string | null = null

      if (isExternal) {
        // 外部链接：协议 + 剩余部分
        target = (match[1] + (match[2] || '')).trim()
        display = target
      } else {
        // 内部链接
        if (match[3]) {
          // 带关系类型：[[页面名]]^(关系类型)
          const relPart = match[3].trim()
          const parsedRel = parseRelationshipPart(relPart)
          relationshipType = parsedRel.relationshipType
          inverseRelationshipType = parsedRel.inverseRelationshipType
          target = match[1].trim()
          display = (match[2] || target).trim()
        } else {
          // 普通链接：[[页面名]]
          target = match[1].trim()
          display = (match[2] || target).trim()
        }
      }

      return {
        targetTitle: target,
        displayText: display,
        position,
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
