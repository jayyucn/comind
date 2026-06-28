import { describe, it, expect, beforeEach } from 'vitest'
import { useContentRenderer } from './useContentRenderer'
import { useRelationshipTypes } from './useRelationshipTypes'
import { getCore } from '../core'

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

describe('useContentRenderer - typed wiki links', () => {
  beforeEach(async () => {
    const { _resetForTest, load } = useRelationshipTypes()
    
    // 完全重置 state
    _resetForTest()
    
    // 清空 storage 中的 relationshipTypes - 先软删除活跃项，再硬删除所有项
    const core = getCore()
    const activeResult = await core.relationshipTypeService.getActive()
    for (const r of activeResult) {
      await core.relationshipTypeService.softDelete(r.id)
    }
    const allResult = await core.storage.relationshipTypes.findAll()
    for (const r of allResult.items) {
      await core.storage.relationshipTypes.delete(r.id)
    }
    
    // 重新加载种子数据
    await load()
  })

  it('((type))[[X]] 渲染为关系标签 + block-link，关系标签显示中文label', () => {
    // 新格式：((type))[[X]]
    // 渲染样式：
    // - 关系部分显示为 `依赖`（中文 label），颜色用关系色
    // - [[X]] 部分为普通 block-link
    const html = renderContentToHtml('See ((depends-on))[[X]] for details', 'block-1')
    // [[X]] 部分：普通 block-link
    expect(html).toContain('data-page="X"')
    expect(html).toMatch(/<span class="block-link"[^>]*data-page="X"[^>]*>X<\/span>/s)
    // 关系部分：rel-type-label 携带 data-rel-type 和中文label
    expect(html).toContain('data-rel-type="depends-on"')
    expect(html).toContain('data-block-id="block-1"')
    expect(html).toMatch(/<span class="rel-type-label"[^>]*>依赖<\/span><span class="block-link"[^>]*>X<\/span>/s)
  })

  it('关系标签的显示文本 = 中文label', () => {
    expect(renderContentToHtml('((depends-on))[[A]]', 'b')).toMatch(
      /<span class="rel-type-label"[^>]*>依赖<\/span>/
    )
    expect(renderContentToHtml('((required-by))[[A]]', 'b')).toMatch(
      /<span class="rel-type-label"[^>]*>被依赖<\/span>/
    )
    expect(renderContentToHtml('((is-a))[[A]]', 'b')).toMatch(
      /<span class="rel-type-label"[^>]*>是一个<\/span>/
    )
  })

  it('未知类型显示 unknown-type（fallback 到类型本身）', () => {
    const html = renderContentToHtml('((unknown-type))[[X]]', 'block-1')
    expect(html).toMatch(/<span class="rel-type-label"[^>]*>unknown-type<\/span>/)
    expect(html).toMatch(/--rel-color:\s*#9CA3AF/)
  })

  it('((depends-on))[[X]] 的字符偏移正确写入 data 属性', () => {
    const html = renderContentToHtml('((depends-on))[[X]]', 'block-1')
    // 原始文本 ((depends-on))[[X]] 长度 19
    const typedFrom = html.match(/data-typed-from="(\d+)"/)
    const typedTo = html.match(/data-typed-to="(\d+)"/)
    expect(typedFrom?.[1]).toBe('0')
    expect(typedTo?.[1]).toBe('19')
    // depends-on 在原始文本中的范围是 2..12（(( 之后）
    const labelFrom = html.match(/data-label-from="(\d+)"/)
    const labelTo = html.match(/data-label-to="(\d+)"/)
    expect(labelFrom?.[1]).toBe('2')
    expect(labelTo?.[1]).toBe('12')
  })

  it('普通 [[X]] 不被识别为 typed link', () => {
    const html = renderContentToHtml('See [[X]] plain', 'block-1')
    expect(html).not.toContain('block-link-typed')
    expect(html).toContain('class="block-link"')
  })

  it('((required-by))[[First]] 的 style 属性不被 #tag 正则误匹配', () => {
    // 回归测试：style="--rel-color:#f5222d" 中的 #f5222d 不应被 #tag 正则包装
    const html = renderContentToHtml('((required-by))[[First]]', 'block-1')
    expect(html).toMatch(/style="--rel-color:#f5222d"/)
    expect(html).not.toContain('data-page="f5222d"')
  })

  it('((depends-on))[[A]] 的 #f5222d 颜色值不被 #tag 正则误匹配', () => {
    // 依赖关系 depends-on 颜色也是 #f5222d（同 inverse）
    const html = renderContentToHtml('((depends-on))[[A]]', 'block-1')
    expect(html).toMatch(/style="--rel-color:#f5222d"/)
    expect(html).not.toContain('data-page="f5222d"')
  })

  it('((is-a))[[A]] 的 #1890ff 颜色值不被 #tag 正则误匹配', () => {
    // is-a 关系颜色是 #1890ff
    const html = renderContentToHtml('((is-a))[[A]]', 'block-1')
    expect(html).toMatch(/style="--rel-color:#1890ff"/)
    expect(html).not.toContain('data-page="1890ff"')
  })

  it('typed link 与 #tag 共存时两者都正确渲染', () => {
    // 段间 #tag 应在原始 text 上处理，typed 链接后样式完整
    const html = renderContentToHtml('see #myproject and ((related))[[A]]', 'block-1')
    expect(html).toMatch(/data-page="myproject"/)
    expect(html).toMatch(/data-rel-type="related"/)
    expect(html).toMatch(/style="--rel-color:#8c8c8c"/)
  })
})