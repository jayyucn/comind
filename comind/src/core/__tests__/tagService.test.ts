/**
 * Core Layer - TagService 单元测试
 */

import { describe, it, expect } from 'vitest'
import { TagService } from '../services/tagService'

describe('TagService', () => {
  let service: TagService

  beforeEach(() => {
    service = new TagService()
  })

  // =============================================================================
  // parseTags
  // =============================================================================

  describe('parseTags', () => {
    it('应解析简单标签', () => {
      const tags = service.parseTags('Hello #world')
      expect(tags.length).toBe(1)
      expect(tags[0].name).toBe('world')
      expect(tags[0].isNested).toBe(false)
    })

    it('应解析多个标签', () => {
      const tags = service.parseTags('Hello #world and #testing')
      expect(tags.length).toBe(2)
      expect(tags[0].name).toBe('world')
      expect(tags[1].name).toBe('testing')
    })

    it('应解析嵌套标签', () => {
      const tags = service.parseTags('Project #work/important')
      expect(tags.length).toBe(1)
      expect(tags[0].name).toBe('work/important')
      expect(tags[0].isNested).toBe(true)
    })

    it('应返回 fullMatch', () => {
      const tags = service.parseTags('Hello #world')
      expect(tags[0].fullMatch).toBe('#world')
    })

    it('应处理中文标签', () => {
      const tags = service.parseTags('这是一个#中文标签')
      expect(tags.length).toBe(1)
      expect(tags[0].name).toBe('中文标签')
    })

    it('应处理带下划线的标签', () => {
      const tags = service.parseTags('Hello #hello_world')
      expect(tags.length).toBe(1)
      expect(tags[0].name).toBe('hello_world')
    })

    it('应处理标签在文本开头', () => {
      const tags = service.parseTags('#first is the beginning')
      expect(tags.length).toBe(1)
      expect(tags[0].name).toBe('first')
    })

    it('应处理标签在文本结尾', () => {
      const tags = service.parseTags('end with #last')
      expect(tags.length).toBe(1)
      expect(tags[0].name).toBe('last')
    })

    it('应处理多级嵌套标签', () => {
      const tags = service.parseTags('#a/b/c/d')
      expect(tags.length).toBe(1)
      expect(tags[0].name).toBe('a/b/c/d')
      expect(tags[0].isNested).toBe(true)
    })

    it('应正确处理邮箱中的标签', () => {
      // 邮箱中的 @ 符号不会被标签正则匹配（不允许 @）
      const tags = service.parseTags('Email me at test@example.com')
      // 不应有标签被匹配
      expect(tags.filter(t => !t.fullMatch.includes('@')).length).toBe(tags.length)
    })

    it('应处理连续的 # 符号', () => {
      const tags = service.parseTags('##not-a-tag')
      // 第二个 # 后面的内容不应被解析为标签
      const tagNames = tags.map(t => t.name)
      expect(tagNames).not.toContain('not-a-tag')
    })

    it('无标签返回空数组', () => {
      const tags = service.parseTags('No tags here')
      expect(tags.length).toBe(0)
    })

    it('空字符串返回空数组', () => {
      const tags = service.parseTags('')
      expect(tags.length).toBe(0)
    })
  })

  // =============================================================================
  // extractUniqueTags
  // =============================================================================

  describe('extractUniqueTags', () => {
    it('应返回唯一的标签名', () => {
      const tags = service.extractUniqueTags('#tag1 and #tag1 again')
      expect(tags.length).toBe(1)
      expect(tags[0]).toBe('tag1')
    })

    it('应返回多个唯一标签', () => {
      const tags = service.extractUniqueTags('#tag1 and #tag2')
      expect(tags.length).toBe(2)
      expect(tags).toContain('tag1')
      expect(tags).toContain('tag2')
    })

    it('嵌套标签应包含父标签', () => {
      const tags = service.extractUniqueTags('#work/important')
      expect(tags).toContain('work')
      expect(tags).toContain('work/important')
    })

    it('多级嵌套标签应包含所有父级', () => {
      const tags = service.extractUniqueTags('#a/b/c')
      expect(tags).toContain('a')
      expect(tags).toContain('a/b')
      expect(tags).toContain('a/b/c')
    })

    it('同一嵌套路径不应重复', () => {
      const tags = service.extractUniqueTags('#work/project and #work/project again')
      expect(tags.filter(t => t === 'work')).toHaveLength(1)
      expect(tags.filter(t => t === 'work/project')).toHaveLength(1)
    })

    it('混合简单标签和嵌套标签', () => {
      const tags = service.extractUniqueTags('#simple and #work/project')
      expect(tags).toContain('simple')
      expect(tags).toContain('work')
      expect(tags).toContain('work/project')
    })
  })

  // =============================================================================
  // highlightTags
  // =============================================================================

  describe('highlightTags', () => {
    it('应为标签添加 span 包装', () => {
      const result = service.highlightTags('Hello #world')
      expect(result).toBe('Hello <span class="tag">#world</span>')
    })

    it('应处理多个标签', () => {
      const result = service.highlightTags('#tag1 and #tag2')
      expect(result).toContain('<span class="tag">#tag1</span>')
      expect(result).toContain('<span class="tag">#tag2</span>')
    })

    it('应处理嵌套标签', () => {
      const result = service.highlightTags('#work/important')
      expect(result).toContain('<span class="tag">#work/important</span>')
    })

    it('应处理中文标签', () => {
      const result = service.highlightTags('这是一个#中文标签')
      expect(result).toContain('<span class="tag">#中文标签</span>')
    })

    it('无标签应返回原文本', () => {
      const result = service.highlightTags('No tags here')
      expect(result).toBe('No tags here')
    })

    it('应保留文本中的其他内容', () => {
      const result = service.highlightTags('Hello #world, how are you?')
      expect(result).toContain('Hello ')
      expect(result).toContain(', how are you?')
    })
  })
})
