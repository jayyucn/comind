import { describe, it, expect } from 'vitest'
import { useContentRenderer } from './useContentRenderer'

const { renderContentToHtml } = useContentRenderer()

describe('useContentRenderer — 渲染测试', () => {
  describe('基础文本转义', () => {
    it('转义 HTML 实体', () => {
      expect(renderContentToHtml('<script>')).toContain('&lt;script&gt;')
      expect(renderContentToHtml('&')).toBe('&amp;')
    })
  })

  describe('WikiLink 渲染', () => {
    it('内部链接 [[页面名]]', () => {
      const result = renderContentToHtml('这是 [[项目A]] 的笔记')
      expect(result).toContain('data-page="项目A"')
      expect(result).toContain('项目A')
    })

    it('带别名的链接 [[页面名|显示名]]', () => {
      const result = renderContentToHtml('参考 [[项目A|A项目]]')
      expect(result).toContain('data-page="项目A"')
      expect(result).toContain('A项目')
    })

    it('外部链接 [[https://...]]', () => {
      const result = renderContentToHtml('访问 [[https://example.com]]')
      expect(result).toContain('external')
      expect(result).toContain('https://example.com')
    })
  })

  describe('#tag 渲染为 Page 链接', () => {
    it('基础标签 #标签', () => {
      const result = renderContentToHtml('这是 #标签')
      expect(result).toContain('block-tag')
      expect(result).toContain('data-page="标签"')
    })

    it('中文标签 #中文', () => {
      const result = renderContentToHtml('#中文 #日本語')
      expect(result).toContain('data-page="中文"')
      expect(result).toContain('data-page="日本語"')
    })

    it('带层级的标签 #项目/子项目', () => {
      const result = renderContentToHtml('#项目/子项目')
      expect(result).toContain('data-page="项目/子项目"')
    })

    it('含点的标签部分匹配 #v1.0', () => {
      // 当前实现只匹配到 #v1，剩余的 .0 是纯文本
      const result = renderContentToHtml('#v1.0')
      expect(result).toContain('block-tag')
      expect(result).toContain('#v1')
    })

    it('排除 URL 上下文 #', () => {
      // 在 URL 或类似上下文中的 # 不识别为标签
      const result = renderContentToHtml('https://example.com/#section')
      expect(result).not.toContain('block-tag')
    })

    it('排除数字开头的 #123', () => {
      const result = renderContentToHtml('#123')
      // 标签不应该匹配数字开头的
      expect(result).not.toContain('block-tag')
    })
  })

  describe('混合场景', () => {
    it('同时包含 WikiLink 和 #tag', () => {
      const result = renderContentToHtml('查看 [[项目A]] 和 #标签')
      expect(result).toContain('data-page="项目A"')
      expect(result).toContain('data-page="标签"')
    })

    it('纯文本', () => {
      const result = renderContentToHtml('这是纯文本')
      expect(result).toBe('这是纯文本')
    })
  })
})
