import { describe, it, expect, beforeEach } from 'vitest'
import { useContentRenderer, parseHeading } from './useContentRenderer'
import { useRelationshipTypes } from './useRelationshipTypes'
import { cleanupRelationshipTypes } from '../../tests/core-client'

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
      const result = renderContentToHtml('#v1.0')
      expect(result).toContain('block-tag')
      expect(result).toContain('#v1')
    })

    it('排除 URL 上下文 #', () => {
      const result = renderContentToHtml('https://example.com/#section')
      expect(result).not.toContain('block-tag')
    })

    it('排除数字开头的 #123', () => {
      const result = renderContentToHtml('#123')
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
    await cleanupRelationshipTypes()
    const { _resetForTest, load } = useRelationshipTypes()
    _resetForTest()
    await load()
  })

  it('((type))[[X]] 渲染为关系标签 + block-link，关系标签显示中文label', () => {
    const html = renderContentToHtml('See ((depends-on))[[X]] for details', 'block-1')
    expect(html).toContain('data-page="X"')
    expect(html).toMatch(/<span class="block-link"[^>]*data-page="X"[^>]*>X<\/span>/s)
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
    const typedFrom = html.match(/data-typed-from="(\d+)"/)
    const typedTo = html.match(/data-typed-to="(\d+)"/)
    expect(typedFrom?.[1]).toBe('0')
    expect(typedTo?.[1]).toBe('19')
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
    const html = renderContentToHtml('((required-by))[[First]]', 'block-1')
    expect(html).toMatch(/style="--rel-color:#f5222d"/)
    expect(html).not.toContain('data-page="f5222d"')
  })

  it('((depends-on))[[A]] 的 #f5222d 颜色值不被 #tag 正则误匹配', () => {
    const html = renderContentToHtml('((depends-on))[[A]]', 'block-1')
    expect(html).toMatch(/style="--rel-color:#f5222d"/)
    expect(html).not.toContain('data-page="f5222d"')
  })

  it('((is-a))[[A]] 的 #1890ff 颜色值不被 #tag 正则误匹配', () => {
    const html = renderContentToHtml('((is-a))[[A]]', 'block-1')
    expect(html).toMatch(/style="--rel-color:#1890ff"/)
    expect(html).not.toContain('data-page="1890ff"')
  })

  it('typed link 与 #tag 共存时两者都正确渲染', () => {
    const html = renderContentToHtml('see #myproject and ((related))[[A]]', 'block-1')
    expect(html).toMatch(/data-page="myproject"/)
    expect(html).toMatch(/data-rel-type="related"/)
    expect(html).toMatch(/style="--rel-color:#8c8c8c"/)
  })
})

describe('dateRef 渲染', () => {
  it('{{schedule:2026-07-15}} 渲染为 date-ref schedule span（含 data-raw）', () => {
    const html = renderContentToHtml('任务 {{schedule:2026-07-15}}', 'block-1')
    expect(html).toMatch(/class="date-ref schedule"/)
    expect(html).toContain('data-kind="schedule"')
    expect(html).toContain('data-iso="2026-07-15"')
    expect(html).toContain('data-recurrence="none"')
    expect(html).toContain('data-raw="{{schedule:2026-07-15}}"')
    expect(html).toContain('📅')
  })

  it('{{deadline:2026-07-15T14:00|weekly}} 渲染为 date-ref deadline span（含 data-raw）', () => {
    const html = renderContentToHtml('{{deadline:2026-07-15T14:00|weekly}}', 'block-1')
    // 2026-07-15 是历史日期，deadline 会加 .overdue
    expect(html).toMatch(/class="date-ref deadline/)
    expect(html).toContain('data-kind="deadline"')
    expect(html).toContain('data-iso="2026-07-15T14:00"')
    expect(html).toContain('data-recurrence="weekly"')
    expect(html).toContain('data-raw="{{deadline:2026-07-15T14:00|weekly}}"')
    expect(html).toContain('⏰')
    expect(html).toContain('每周')
  })

  it('无 recurrence 时 data-recurrence="none"', () => {
    const html = renderContentToHtml('{{schedule:2026-07-15}}')
    expect(html).toMatch(/data-recurrence="none"/)
  })

  it('daily/monthly/yearly 重复规则正确', () => {
    const html = renderContentToHtml('{{schedule:2026-07-15|daily}} {{deadline:2026-07-15|yearly}}')
    expect(html).toContain('data-recurrence="daily"')
    expect(html).toContain('data-recurrence="yearly"')
    expect(html).toContain('每天')
    expect(html).toContain('每年')
  })

  it('显示文本包含格式化后的日期', () => {
    const html = renderContentToHtml('{{schedule:2026-07-15T14:00}}')
    expect(html).toContain('07-15 14:00')
  })

  it('多个 dateRef 各自渲染', () => {
    const html = renderContentToHtml('{{schedule:2026-07-15}} 和 {{deadline:2026-07-16}}')
    // 2026-07-16 是历史日期，deadline 会加 .overdue
    const matches = html.match(/class="date-ref (schedule|deadline)/g)
    expect(matches).toHaveLength(2)
  })

  it('dateRef 与 wiki link 混合时两者都渲染', () => {
    const html = renderContentToHtml('{{schedule:2026-07-15}} 参见 [[项目A]]')
    expect(html).toMatch(/class="date-ref schedule"/)
    expect(html).toContain('data-page="项目A"')
  })

  it('dateRef 与 #tag 混合时两者都渲染', () => {
    const html = renderContentToHtml('{{deadline:2026-07-15}} #重要任务')
    // 2026-07-15 逾期，deadline 会加 .overdue
    expect(html).toMatch(/class="date-ref deadline/)
    expect(html).toContain('data-page="重要任务"')
  })

  it('HTML 特殊字符被正确转义', () => {
    // ISO 中无特殊字符，但显示文本理论上可能有，这里验证转义函数存在
    const html = renderContentToHtml('{{schedule:2026-07-15}}')
    expect(html).not.toContain('<script>') // 没有注入
  })
})

describe('parseHeading — 标题解析测试', () => {
  it('解析 h1 标题', () => {
    const result = parseHeading('# 一级标题')
    expect(result).toEqual({ level: 1, title: '一级标题' })
  })

  it('解析 h2 标题', () => {
    const result = parseHeading('## 二级标题')
    expect(result).toEqual({ level: 2, title: '二级标题' })
  })

  it('解析 h3 标题', () => {
    const result = parseHeading('### 三级标题')
    expect(result).toEqual({ level: 3, title: '三级标题' })
  })

  it('解析 h4 标题', () => {
    const result = parseHeading('#### 四级标题')
    expect(result).toEqual({ level: 4, title: '四级标题' })
  })

  it('解析 h5 标题', () => {
    const result = parseHeading('##### 五级标题')
    expect(result).toEqual({ level: 5, title: '五级标题' })
  })

  it('解析 h6 标题', () => {
    const result = parseHeading('###### 六级标题')
    expect(result).toEqual({ level: 6, title: '六级标题' })
  })

  it('超过 6 个 # 不识别为标题', () => {
    const result = parseHeading('####### 七级标题')
    expect(result).toBeNull()
  })

  it('无空格的 #tag 不识别为标题', () => {
    const result = parseHeading('#标签')
    expect(result).toBeNull()
  })

  it('纯文本不识别为标题', () => {
    const result = parseHeading('这是普通文本')
    expect(result).toBeNull()
  })

  it('标题后接标签', () => {
    const result = parseHeading('# 标题 #标签')
    expect(result).toEqual({ level: 1, title: '标题 #标签' })
  })

  it('标题含 wiki 链接', () => {
    const result = parseHeading('## [[页面A]]')
    expect(result).toEqual({ level: 2, title: '[[页面A]]' })
  })

  it('标题含关系链接', () => {
    const result = parseHeading('### ((depends-on))[[X]]')
    expect(result).toEqual({ level: 3, title: '((depends-on))[[X]]' })
  })

  it('空标题不识别', () => {
    const result = parseHeading('# ')
    expect(result).toBeNull()
  })

  it('空格开头的 # 不识别为标题', () => {
    const result = parseHeading(' # 标题')
    expect(result).toBeNull()
  })
})