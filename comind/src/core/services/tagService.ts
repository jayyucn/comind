/**
 * Core Layer - Tag 服务
 *
 * 提供 Tag（标签）相关的业务逻辑。
 *
 * Phase 1: 从 Block.content 解析，不单独存储
 * Phase 2: 引入独立 Tag 存储
 */

import type { TagParse } from '../types'

/**
 * Tag 解析正则
 *
 * 匹配 #标签名 或 #父标签/子标签
 */
const TAG_REGEX = /#([\p{L}_][\p{L}\p{N}_/]*(?:\/[\p{L}_][\p{L}\p{N}_]*)*)/gu

/**
 * 排除规则：URL 中的锚点、邮箱不识别
 */
const EXCLUDE_PATTERNS = [
  /^https?:\/\//i,      // URL 协议
  /^mailto:/i,           // 邮箱协议
]

/**
 * Tag Service
 *
 * 提供 Tag 相关的业务逻辑。
 *
 * 当前实现：
 * - 仅解析功能，从文本中提取标签
 * - 不涉及存储（Phase 2 扩展）
 */
export class TagService {
  /**
   * 解析文本中的所有标签
   *
   * @param content 文本内容
   * @returns 标签解析结果列表
   */
  parseTags(content: string): TagParse[] {
    const tags: TagParse[] = []
    let match: RegExpExecArray | null

    const regex = new RegExp(TAG_REGEX.source, 'gu')

    while ((match = regex.exec(content)) !== null) {
      const fullMatch = match[0]
      const name = match[1]

      // 排除规则检查
      const shouldExclude = EXCLUDE_PATTERNS.some(pattern =>
        pattern.test(fullMatch.slice(1))
      )
      if (shouldExclude) continue

      tags.push({
        fullMatch,
        name,
        isNested: name.includes('/'),
      })
    }

    return tags
  }

  /**
   * 提取所有唯一的标签名
   *
   * @param content 文本内容
   * @returns 唯一标签名列表
   */
  extractUniqueTags(content: string): string[] {
    const tags = this.parseTags(content)
    const uniqueTags = new Set<string>()

    for (const tag of tags) {
      // 如果是嵌套标签，也添加父标签
      if (tag.isNested) {
        const parts = tag.name.split('/')
        for (let i = 0; i < parts.length; i++) {
          uniqueTags.add(parts.slice(0, i + 1).join('/'))
        }
      } else {
        uniqueTags.add(tag.name)
      }
    }

    return Array.from(uniqueTags)
  }

  /**
   * 高亮文本中的标签
   *
   * @param content 文本内容
   * @returns 带高亮的 HTML 字符串
   */
  highlightTags(content: string): string {
    return content.replace(TAG_REGEX, '<span class="tag">#$1</span>')
  }
}
