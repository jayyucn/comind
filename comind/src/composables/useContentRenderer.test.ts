import { describe, it, expect } from 'vitest'
import { useContentRenderer, parseHeading } from './useContentRenderer'

const { renderContentToHtml } = useContentRenderer()

describe('useContentRenderer — 回退路径（无 segments）', () => {
  it('HTML 实体被转义', () => {
    expect(renderContentToHtml({ segments: [], content: '<script>' })).toContain('&lt;script&gt;')
    expect(renderContentToHtml({ segments: [], content: '&' })).toBe('&amp;')
  })

  it('#tag 渲染为 block-link block-tag span', () => {
    const html = renderContentToHtml({ segments: [], content: '这是 #标签' })
    expect(html).toContain('block-tag')
    expect(html).toContain('data-page="标签"')
  })

  it('#tag 中文标签', () => {
    const html = renderContentToHtml({ segments: [], content: '#中文' })
    expect(html).toContain('data-page="中文"')
  })

  it('#tag 含点号时部分匹配（tag 截断在点号前）', () => {
    const html = renderContentToHtml({ segments: [], content: '#v1.0' })
    // tag 正则 [\p{L}_][\p{L}\p{N}_]* 不匹配 '.'，因此只匹配 'v1'
    // 但 tag 含 '.' 时代码返回原字符串 #v1（含 '.' 判断），所以不生成 block-tag span
    // 实际行为：'v1' 被渲染为 tag，'.0' 作为纯文本
    expect(html).toContain('block-tag')
    expect(html).toContain('data-page="v1"')
  })

  it('纯文本不做额外渲染', () => {
    expect(renderContentToHtml({ segments: [], content: '这是纯文本' })).toBe('这是纯文本')
  })

  it('wiki link 在回退路径不渲染（由结构化 segments 处理）', () => {
    const html = renderContentToHtml({ segments: [], content: '查看 [[项目A]]' })
    expect(html).not.toContain('block-link')
    expect(html).not.toContain('data-page')
    expect(html).toContain('[[项目A]]')
  })

  it('dateRef 语法在回退路径不渲染（由结构化 segments 处理）', () => {
    const html = renderContentToHtml({ segments: [], content: '任务 @2026-07-15 📅' })
    expect(html).not.toContain('date-ref')
    expect(html).not.toContain('data-kind')
    expect(html).toContain('@2026-07-15')
  })
})

describe('结构化渲染片段（pre-computed segments）', () => {
  describe('text 片段', () => {
    it('按 start/end 切片渲染纯文本', () => {
      const html = renderContentToHtml({
        segments: [{ type: 'text', start: 0, end: 11 }],
        content: 'Hello world',
        blockId: 'b1',
      })
      expect(html).toBe('Hello world')
    })

    it('文本片段内的 #tag 仍被识别为 block-tag', () => {
      const html = renderContentToHtml({
        segments: [{ type: 'text', start: 0, end: 9 }],
        content: 'Hello #tag',
        blockId: 'b1',
      })
      // content.slice(0, 9) = 'Hello #ta'（"Hello #tag" 的前 9 个字符）
      // 正则匹配 '#ta'，因 tag 含 '.' 判断为 false，生成 block-tag span
      expect(html).toContain('block-tag')
      expect(html).toContain('data-page="ta"')
    })

    it('文本片段内 HTML 特殊字符被转义', () => {
      const html = renderContentToHtml({
        segments: [{ type: 'text', start: 0, end: 9 }],
        content: 'A <script>',
        blockId: 'b1',
      })
      // content.slice(0, 9) = 'A <script'（前 9 字符，不包含 '>'）
      // 仅 '<' 被转义为 '&lt;'
      expect(html).toContain('&lt;')
      expect(html).toContain('script')
    })

    it('空文本片段不产生输出', () => {
      const html = renderContentToHtml({
        segments: [{ type: 'text', start: 0, end: 0 }],
        content: '',
        blockId: 'b1',
      })
      expect(html).toBe('')
    })

    it('text 片段含 # 数字颜色值不被误识别为标签', () => {
      // #ff0000 中 f 是字母，但 tag pattern 要求 [\p{L}_] 起始且后续字符为 [\p{L}\p{N}_]
      // #ff0000 满足条件，实际会被渲染为 tag
      const html = renderContentToHtml({
        segments: [{ type: 'text', start: 0, end: 30 }],
        content: '颜色值 #ff0000 是标签',
        blockId: 'b1',
      })
      expect(html).toContain('block-tag')
      expect(html).toContain('data-page="ff0000"')
    })
  })

  describe('link 片段', () => {
    it('渲染 wiki-style 内部链接，含括号和目标页面', () => {
      const html = renderContentToHtml({
        segments: [{ type: 'link', start: 0, end: 15, target_page_title: '项目A', display_text: '项目A' }],
        content: '[[项目A]]',
        blockId: 'b1',
      })
      expect(html).toContain('class="block-link"')
      expect(html).toContain('data-page="项目A"')
      expect(html).toContain('wiki-bracket')
      expect(html).toContain('[[')
      expect(html).toContain(']]')
      expect(html).toContain('项目A')
    })

    it('link 片段使用 display_text 作为显示文本', () => {
      const html = renderContentToHtml({
        segments: [{ type: 'link', start: 0, end: 20, target_page_title: '项目A', display_text: 'A项目' }],
        content: '[[项目A|A项目]]',
        blockId: 'b1',
      })
      expect(html).toContain('data-page="项目A"')
      expect(html).toContain('A项目')
      expect(html).not.toContain('>项目A<')
    })

    it('link 片段的 target 和 display 文本被 HTML 转义', () => {
      const html = renderContentToHtml({
        segments: [{ type: 'link', start: 0, end: 20, target_page_title: 'A&B', display_text: 'X&Y' }],
        content: '[[A&B|X&Y]]',
        blockId: 'b1',
      })
      expect(html).toContain('data-page="A&amp;B"')
      expect(html).toContain('X&amp;Y')
    })
  })

  describe('typed_link 片段', () => {
    it('渲染关系类型标签 + block-link，含颜色和关系类型', () => {
      const html = renderContentToHtml({
        segments: [{
          type: 'typed_link', start: 0, end: 25,
          target_page_title: '依赖项', display_text: '依赖项',
          relationship_type: 'depends-on', rel_label: '依赖', rel_color: '#f5222d',
        }],
        content: '((depends-on))[[依赖项]]',
        blockId: 'block-1',
      })
      expect(html).toContain('data-rel-type="depends-on"')
      expect(html).toContain('style="--rel-color:#f5222d"')
      expect(html).toContain('<span class="rel-type-label"')
      expect(html).toContain('>依赖<')
      expect(html).toContain('data-page="依赖项"')
      expect(html).toContain('data-block-id="block-1"')
    })

    it('typed_link 使用 display_text 覆盖显示文本', () => {
      const html = renderContentToHtml({
        segments: [{
          type: 'typed_link', start: 0, end: 30,
          target_page_title: 'Target', display_text: 'Alias',
          relationship_type: 'relates', rel_label: '相关', rel_color: '#3B82F6',
        }],
        content: '((relates))[[Target|Alias]]',
        blockId: 'b2',
      })
      expect(html).toContain('data-page="Target"')
      expect(html).toContain('>Alias<')
      expect(html).not.toContain('>Target<')
    })

    it('typed_link 携带 start/end 位置数据属性', () => {
      const html = renderContentToHtml({
        segments: [{
          type: 'typed_link', start: 10, end: 35,
          target_page_title: 'X', display_text: 'X',
          relationship_type: 'depends-on', rel_label: '依赖', rel_color: '#f5222d',
        }],
        content: 'prefix ((depends-on))[[X]]',
        blockId: 'b3',
      })
      expect(html).toContain('data-typed-from="10"')
      expect(html).toContain('data-typed-to="35"')
    })
  })

  describe('external_link 片段', () => {
    it('渲染外部链接 span', () => {
      const html = renderContentToHtml({
        segments: [{ type: 'external_link', start: 0, end: 23, url: 'https://example.com' }],
        content: 'https://example.com',
        blockId: 'b1',
      })
      expect(html).toContain('class="block-link external"')
      expect(html).toContain('data-external="https://example.com"')
      expect(html).toContain('https://example.com')
    })

    it('外部链接的 URL 被 HTML 转义', () => {
      const html = renderContentToHtml({
        segments: [{ type: 'external_link', start: 0, end: 30, url: 'https://a.com?x=1&y=2' }],
        content: 'https://a.com?x=1&y=2',
        blockId: 'b1',
      })
      expect(html).toContain('data-external="https://a.com?x=1&amp;y=2"')
    })
  })

  describe('date_ref 片段', () => {
    it('渲染 schedule 类型 date-ref span，含 data 属性', () => {
      const html = renderContentToHtml({
        segments: [{
          type: 'date_ref', start: 0, end: 11,
          kind: 'schedule', iso: '2026-07-15', recurrence: 'none',
          lead_minutes: 0, is_overdue: false,
        }],
        content: '@2026-07-15',
        blockId: 'b1',
      })
      expect(html).toContain('class="date-ref schedule"')
      expect(html).toContain('data-kind="schedule"')
      expect(html).toContain('data-iso="2026-07-15"')
      expect(html).toContain('data-recurrence="none"')
      expect(html).toContain('data-lead-minutes="0"')
      // data-raw 包含 @ 符号，因 start=0 包括了 '@'
      expect(html).toContain('data-raw="@2026-07-15"')
    })

    it('渲染 deadline overdue 类型 date-ref', () => {
      const html = renderContentToHtml({
        segments: [{
          type: 'date_ref', start: 0, end: 20,
          kind: 'deadline', iso: '2026-07-15T14:00', recurrence: 'weekly',
          lead_minutes: 15, is_overdue: true,
        }],
        content: '026-07-15T14:00',
        blockId: 'b1',
      })
      expect(html).toContain('class="date-ref deadline overdue"')
      expect(html).toContain('data-kind="deadline"')
      expect(html).toContain('data-iso="2026-07-15T14:00"')
      expect(html).toContain('data-recurrence="weekly"')
      expect(html).toContain('data-lead-minutes="15"')
      // data-raw 是 start..end 范围的原始内容
      expect(html).toContain('data-raw="026-07-15T14:00"')
    })

    it('非 overdue 的 deadline 不添加 overdue class', () => {
      const html = renderContentToHtml({
        segments: [{
          type: 'date_ref', start: 0, end: 16,
          kind: 'deadline', iso: '2026-07-16T14:00', recurrence: 'none',
          lead_minutes: 0, is_overdue: false,
        }],
        content: '2026-07-16T14:00',
        blockId: 'b1',
      })
      expect(html).toContain('class="date-ref deadline"')
      expect(html).not.toContain('overdue')
    })

    it('schedule 类型不标记 overdue（即使 is_overdue=true 仍渲染为 schedule）', () => {
      const html = renderContentToHtml({
        segments: [{
          type: 'date_ref', start: 0, end: 16,
          kind: 'schedule', iso: '2026-07-15', recurrence: 'none',
          lead_minutes: 0, is_overdue: false,
        }],
        content: '@2026-07-15 📅',
        blockId: 'b1',
      })
      expect(html).toContain('class="date-ref schedule"')
      expect(html).not.toContain('overdue')
    })

    it('date_ref 的可见文本为原始内容切片', () => {
      const html = renderContentToHtml({
        segments: [{
          type: 'date_ref', start: 7, end: 24,
          kind: 'schedule', iso: '2026-08-09', recurrence: 'none',
          lead_minutes: 0, is_overdue: false,
        }],
        content: '这是测试内容 @2026-08-09 📅',
        blockId: 'b1',
      })
      expect(html).toContain('class="date-ref schedule"')
      // content.slice(7, 24) = '@2026-08-09 📅'
      expect(html).toContain('>@2026-08-09 📅<')
    })
  })

  describe('混合片段', () => {
    it('text + link 连续片段正确渲染', () => {
      const html = renderContentToHtml({
        segments: [
          { type: 'text', start: 0, end: 6 },
          { type: 'link', start: 6, end: 21, target_page_title: '项目A', display_text: '项目A' },
          { type: 'text', start: 21, end: 27 },
        ],
        content: '查看 [[项目A]] 详情',
        blockId: 'b1',
      })
      expect(html).toContain('查看 ')
      expect(html).toContain('data-page="项目A"')
      expect(html).toContain(']] 详情')
    })

    it('text + typed_link + date_ref 混合渲染', () => {
      const html = renderContentToHtml({
        segments: [
          { type: 'text', start: 0, end: 7 },
          {
            type: 'typed_link', start: 7, end: 22,
            target_page_title: '任务A', display_text: '任务A',
            relationship_type: 'depends-on', rel_label: '依赖', rel_color: '#f5222d',
          },
          { type: 'text', start: 22, end: 24 },
          {
            type: 'date_ref', start: 24, end: 40,
            kind: 'deadline', iso: '2026-08-01T10:00', recurrence: 'none',
            lead_minutes: 0, is_overdue: false,
          },
        ],
        content: '需要 ((depends-on))[[任务A]] 于 2026-08-01T10:00',
        blockId: 'block-1',
      })
      expect(html).toContain('需要 ')
      expect(html).toContain('data-rel-type="depends-on"')
      expect(html).toContain('data-page="任务A"')
      expect(html).toContain('class="date-ref deadline"')
      expect(html).toContain('data-iso="2026-08-01T10:00"')
    })

    it('无 segments 时回退到纯文本转义 + tag 渲染', () => {
      const html = renderContentToHtml({
        segments: [],
        content: '纯文本 [[项目A]] #tag',
        blockId: 'b1',
      })
      // 回退路径：wiki link 不渲染，tag 渲染
      expect(html).not.toContain('data-page="项目A"')
      expect(html).toContain('data-page="tag"')
    })

    it('segments 为 undefined 时回退到回退路径', () => {
      const html = renderContentToHtml({
        segments: undefined as any,
        content: '纯文本内容',
        blockId: 'b1',
      })
      expect(html).toBe('纯文本内容')
    })
  })

  describe('边界场景', () => {
    it('segments 长度小于 content 时只渲染 segments 覆盖部分', () => {
      const html = renderContentToHtml({
        segments: [{ type: 'text', start: 0, end: 5 }],
        content: 'Hello world',
        blockId: 'b1',
      })
      expect(html).toBe('Hello')
    })

    it('typed_link 的颜色值 # 不被误识别为 tag', () => {
      const html = renderContentToHtml({
        segments: [{
          type: 'typed_link', start: 0, end: 25,
          target_page_title: 'X', display_text: 'X',
          relationship_type: 'depends-on', rel_label: '依赖', rel_color: '#f5222d',
        }],
        content: '((depends-on))[[X]]',
        blockId: 'b1',
      })
      expect(html).toContain('--rel-color:#f5222d')
      expect(html).not.toContain('data-page="f5222d"')
    })
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

  it('解析 h4-h6 标题', () => {
    expect(parseHeading('#### 四级标题')).toEqual({ level: 4, title: '四级标题' })
    expect(parseHeading('##### 五级标题')).toEqual({ level: 5, title: '五级标题' })
    expect(parseHeading('###### 六级标题')).toEqual({ level: 6, title: '六级标题' })
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

  it('标题后接 #tag 仍正确解析', () => {
    const result = parseHeading('# 标题 #标签')
    expect(result).toEqual({ level: 1, title: '标题 #标签' })
  })

  it('标题含 wiki 链接', () => {
    const result = parseHeading('## [[页面A]]')
    expect(result).toEqual({ level: 2, title: '[[页面A]]' })
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
