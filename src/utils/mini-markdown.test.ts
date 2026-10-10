import { describe, expect, it } from 'vitest'
import { escapeHtml, renderInlineMarkdown, toExternalHref } from './mini-markdown'

describe('mini-markdown（T6 richtext 最小渲染）', () => {
  describe('escapeHtml', () => {
    it('转义全部危险字符', () => {
      expect(escapeHtml(`<img src=x onerror="alert('1')">&`)).toBe(
        '&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;&amp;',
      )
    })
  })

  describe('renderInlineMarkdown', () => {
    it('纯文本原样输出', () => {
      expect(renderInlineMarkdown('你好，世界')).toBe('你好，世界')
    })

    it('换行渲染为 <br>', () => {
      expect(renderInlineMarkdown('第一行\n第二行')).toBe('第一行<br>第二行')
    })

    it('粗体 / 斜体', () => {
      expect(renderInlineMarkdown('**粗** 与 *斜*')).toBe('<strong>粗</strong> 与 <em>斜</em>')
    })

    it('行内代码：内容只转义，不参与其他标记', () => {
      expect(renderInlineMarkdown('用 `a**b**` 看看')).toBe('用 <code>a**b**</code> 看看')
      expect(renderInlineMarkdown('注入 `<img>`')).toBe('注入 <code>&lt;img&gt;</code>')
    })

    it('链接渲染为带 rel 的锚点', () => {
      expect(renderInlineMarkdown('[示例](https://e.com)')).toBe(
        '<a href="https://e.com" target="_blank" rel="noopener noreferrer">示例</a>',
      )
    })

    it('HTML 输入被整体转义，无注入面', () => {
      const out = renderInlineMarkdown('<script>alert(1)</script>')
      expect(out).not.toContain('<script>')
      expect(out).toContain('&lt;script&gt;')
    })

    it('md 链接 href 过 toExternalHref 闸：javascript: 降级纯文本（code-review Spec#1 XSS 回归）', () => {
      const out = renderInlineMarkdown('[点我](javascript:alert(1))')
      expect(out).not.toContain('<a ')
      expect(out).not.toContain('javascript:')
      expect(out).toContain('点我')
    })
    it('md 链接合法 url 正常渲染', () => {
      const out = renderInlineMarkdown('[示例](https://e.com)')
      expect(out).toContain('<a href="https://e.com"')
    })
  })

  describe('toExternalHref', () => {
    it('无 scheme 补 https://', () => {
      expect(toExternalHref('example.com/a')).toBe('https://example.com/a')
    })
    it('http(s) / mailto 原样保留', () => {
      expect(toExternalHref('http://e.com')).toBe('http://e.com')
      expect(toExternalHref('mailto:a@b.c')).toBe('mailto:a@b.c')
    })
    it('javascript: 等危险 scheme 返回 null 拒渲染', () => {
      expect(toExternalHref('javascript:alert(1)')).toBeNull()
      expect(toExternalHref('data:text/html,x')).toBeNull()
    })
    it('空值返回 null', () => {
      expect(toExternalHref('')).toBeNull()
      expect(toExternalHref(null)).toBeNull()
      expect(toExternalHref(undefined)).toBeNull()
    })
  })
})
