import { describe, it, expect } from 'vitest'
import { parseTagQuery, isTagTriggerText } from './TagInputExtension'

describe('TagInputExtension 纯函数（#132）', () => {
  describe('parseTagQuery', () => {
    it('抽取 # 之后到边界的标签名', () => {
      expect(parseTagQuery('Book')).toBe('Book')
      expect(parseTagQuery('Book ')).toBe('Book')
      expect(parseTagQuery('my-tag')).toBe('my-tag')
    })

    it('无有效字符（空白 / 空 / 另一 #）返回 null', () => {
      expect(parseTagQuery('')).toBeNull()
      expect(parseTagQuery(' ')).toBeNull()
      expect(parseTagQuery('#x')).toBeNull()
    })

    it('超长截断到 50', () => {
      const long = 'a'.repeat(80)
      expect(parseTagQuery(long)?.length).toBe(50)
    })
  })

  describe('isTagTriggerText', () => {
    it('行首 # 触发', () => {
      expect(isTagTriggerText('', '')).toBe(true)
      expect(isTagTriggerText('', 'B')).toBe(true)
    })

    it('空白后 # 触发', () => {
      expect(isTagTriggerText('hello ', '')).toBe(true)
    })

    it('词中 # 不触发（a#b）', () => {
      expect(isTagTriggerText('a', 'b')).toBe(false)
    })

    it('# 后紧跟空白不触发（Markdown 标题 `# `）', () => {
      expect(isTagTriggerText('', ' ')).toBe(false)
    })
  })
})
