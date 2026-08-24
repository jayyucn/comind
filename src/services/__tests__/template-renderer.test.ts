import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { TemplateRenderer } from '../template-renderer'
import type { NormalizedTemplate, TemplateContext } from '../../types/template'
import type { Block } from '../../types/block'

const baseTemplate: NormalizedTemplate = {
  id: 't1',
  name: 'Test',
  category: 'work',
  description: 'Test template',
  icon: '📝',
  source: 'builtin',
  blocks: [
    { type: 'bullet', content: 'Hello' },
    { type: 'heading', content: 'Section', headingLevel: 2 },
    { type: 'property', propertyKey: '时间', content: '{{date}} {{time}}' },
    { type: 'bullet', content: '{{name}}' },
    { type: 'bullet', content: '{{page_title}}' },
    { type: 'bullet', content: '{{iso_date}}' },
    { type: 'bullet', content: '{{clipboard}}' },
    { type: 'heading', content: 'Title {{cursor}}', headingLevel: 2 },
    { type: 'bullet', content: '{{cursor}}' },
  ],
}

const baseContext: TemplateContext = {
  date: '2026年6月5日',
  time: '14:30',
  isoDate: '2026-06-05',
  pageTitle: 'My Page',
  cursor: '__CURSOR__',
  clipboard: 'clip-text',
  now: 1718000000000,
}

const baseAnchor: Block = {
  id: 'anchor', pageId: 'page-1', parentId: null, pos: 1000,
  content: 'anchor', format: {}, type: 'bullet',
  properties: {}, createdAt: 0, updatedAt: 0
}

describe('TemplateRenderer.expandContent', () => {
  test('替换所有预定义变量', () => {
    const result = TemplateRenderer.expandContent('Today is {{date}} at {{time}}', baseContext)
    expect(result.text).toBe('Today is 2026年6月5日 at 14:30')
    expect(result.hasCursor).toBe(false)
  })

  test('未匹配的 {{name}} 保留为可见文本', () => {
    const result = TemplateRenderer.expandContent('Hello {{user_name}}', baseContext)
    expect(result.text).toBe('Hello {{user_name}}')
  })

  test('{{cursor}} 被剥离（不泄漏为字面文本）', () => {
    const result = TemplateRenderer.expandContent('A {{cursor}} B', baseContext)
    expect(result.text).toBe('A  B')
    expect(result.text).not.toContain('__CURSOR__')
    expect(result.hasCursor).toBe(true)
  })

  test('无 {{cursor}} 时 hasCursor 为 false', () => {
    const result = TemplateRenderer.expandContent('Hello {{date}}', baseContext)
    expect(result.text).toBe('Hello 2026年6月5日')
    expect(result.hasCursor).toBe(false)
  })

  test('多个变量混合替换', () => {
    const result = TemplateRenderer.expandContent(
      '{{date}} - {{page_title}} - {{name}}',
      baseContext
    )
    expect(result.text).toBe('2026年6月5日 - My Page - {{name}}')
  })

  test('空字符串输入返回空', () => {
    const result = TemplateRenderer.expandContent('', baseContext)
    expect(result.text).toBe('')
  })
})

describe('TemplateRenderer.render', () => {
  test('渲染为 BlockDraft[]：变量已替换，pos 连续', () => {
    const drafts = TemplateRenderer.render(baseTemplate, baseContext, baseAnchor)
    expect(drafts.length).toBe(9)
    expect(drafts[0].content).toBe('Hello')
    expect(drafts[1].content).toBe('Section')
    expect(drafts[1].format).toEqual({ type: 'heading', level: 2 })
    expect(drafts[2].content).toBe('时间:: 2026年6月5日 14:30')
    expect(drafts[2].type).toBe('property')
    expect(drafts[3].content).toBe('{{name}}')
    expect(drafts[4].content).toBe('My Page')
    expect(drafts[5].content).toBe('2026-06-05')
    expect(drafts[6].content).toBe('clip-text')
    expect(drafts[7].content).toBe('Title ')
    expect(drafts[7].cursorMarker).toBe('__CURSOR__')
    expect(drafts[8].content).toBe('')
    expect(drafts[8].cursorMarker).toBe('__CURSOR__')
    expect(drafts[0].pos).toBe(2000)
    expect(drafts[8].pos).toBe(10000)
  })

  test('cursorMarker 复制到所有含 {{cursor}} 的 Block（consumer 取首个作为光标位置）', () => {
    const drafts = TemplateRenderer.render(baseTemplate, baseContext, baseAnchor)
    const cursors = drafts.filter(d => d.cursorMarker === '__CURSOR__')
    expect(cursors.length).toBe(2)
    const firstIdx = drafts.findIndex(d => d.cursorMarker === '__CURSOR__')
    expect(firstIdx).toBe(7)
  })

  test('children 递归展开为子 Block', () => {
    const tmpl: NormalizedTemplate = {
      ...baseTemplate,
      blocks: [{
        type: 'bullet', content: 'parent',
        children: [
          { type: 'bullet', content: 'child1' },
          { type: 'bullet', content: 'child2' },
        ]
      }]
    }
    const drafts = TemplateRenderer.render(tmpl, baseContext, baseAnchor)
    expect(drafts.length).toBe(3)
    expect(drafts[0].content).toBe('parent')
    expect(drafts[0].parentId).toBeNull()
    expect(drafts[1].parentId).toBe(drafts[0].id)
    expect(drafts[2].parentId).toBe(drafts[0].id)
  })

  test('所有 draft 共享 anchor 的 pageId', () => {
    const drafts = TemplateRenderer.render(baseTemplate, baseContext, baseAnchor)
    for (const d of drafts) {
      expect(d.pageId).toBe(baseAnchor.pageId)
    }
  })

  test('每个 draft 的 id 唯一', () => {
    const drafts = TemplateRenderer.render(baseTemplate, baseContext, baseAnchor)
    const ids = new Set(drafts.map(d => d.id))
    expect(ids.size).toBe(drafts.length)
  })
})

describe('TemplateRenderer.buildContext', () => {
  let originalClipboard: PropertyDescriptor | undefined

  beforeEach(() => {
    originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: vi.fn().mockResolvedValue('mocked-clip') }
    })
  })

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard)
    }
  })

  test('构建完整上下文：date/time/isoDate/clipboard', async () => {
    const ctx = await TemplateRenderer.buildContext('My Page')
    expect(ctx.pageTitle).toBe('My Page')
    expect(ctx.date).toMatch(/^\d{4}年\d{1,2}月\d{1,2}日$/)
    expect(ctx.time).toMatch(/^\d{1,2}:\d{2}$/)
    expect(ctx.isoDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(ctx.clipboard).toBe('mocked-clip')
    expect(ctx.cursor).toBe('__CURSOR__')
    expect(typeof ctx.now).toBe('number')
  })

  test('clipboard 读取失败时返回空字符串', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: vi.fn().mockRejectedValue(new Error('denied')) }
    })
    const ctx = await TemplateRenderer.buildContext('p')
    expect(ctx.clipboard).toBe('')
  })

  test('buildContext 不含 clipboard API 时返回空字符串', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined
    })
    const ctx = await TemplateRenderer.buildContext('p')
    expect(ctx.clipboard).toBe('')
  })
})

describe('TemplateRenderer edge cases', () => {
  test('expandContent 处理连续变量', () => {
    const result = TemplateRenderer.expandContent('{{date}}{{time}}', baseContext)
    expect(result.text).toBe('2026年6月5日14:30')
  })

  test('expandContent 处理变量周围有空格', () => {
    const result = TemplateRenderer.expandContent('A {{ date }} B', baseContext)
    // 注意：VAR_REGEX 只匹配 {{var}} 不匹配 {{ var }}
    expect(result.text).toBe('A {{ date }} B')
  })

  test('expandContent 处理多个 {{cursor}}', () => {
    const result = TemplateRenderer.expandContent('{{cursor}} A {{cursor}} B', baseContext)
    expect(result.text).toBe(' A  B')
    expect(result.hasCursor).toBe(true)
  })

  test('render 处理空 blocks 数组', () => {
    const emptyTemplate: NormalizedTemplate = {
      ...baseTemplate,
      blocks: []
    }
    const drafts = TemplateRenderer.render(emptyTemplate, baseContext, baseAnchor)
    expect(drafts).toEqual([])
  })

  test('render 处理深层嵌套 children', () => {
    const deepTemplate: NormalizedTemplate = {
      ...baseTemplate,
      blocks: [{
        type: 'bullet',
        content: 'level 1',
        children: [{
          type: 'bullet',
          content: 'level 2',
          children: [{
            type: 'bullet',
            content: 'level 3',
            children: [{
              type: 'bullet',
              content: 'level 4'
            }]
          }]
        }]
      }]
    }
    const drafts = TemplateRenderer.render(deepTemplate, baseContext, baseAnchor)
    expect(drafts.length).toBe(4)
    expect(drafts[0].content).toBe('level 1')
    expect(drafts[0].parentId).toBeNull()
    expect(drafts[1].parentId).toBe(drafts[0].id)
    expect(drafts[2].parentId).toBe(drafts[1].id)
    expect(drafts[3].parentId).toBe(drafts[2].id)
  })

  test('render 处理 property block 无 propertyKey', () => {
    const propTemplate: NormalizedTemplate = {
      ...baseTemplate,
      blocks: [{
        type: 'property',
        content: '{{date}}',
        // 无 propertyKey
      }]
    }
    const drafts = TemplateRenderer.render(propTemplate, baseContext, baseAnchor)
    expect(drafts.length).toBe(1)
    // 无 propertyKey 时，content 应该是原始文本（变量已展开）
    expect(drafts[0].content).toBe('2026年6月5日')
  })

  test('expandContent 处理无效变量名', () => {
    // VAR_REGEX 只匹配 [a-zA-Z_][a-zA-Z0-9_]*
    const result = TemplateRenderer.expandContent('{{123}} {{var-name}}', baseContext)
    expect(result.text).toBe('{{123}} {{var-name}}')
  })

  test('render 为每个 draft 生成不同的 id', () => {
    const multiTemplate: NormalizedTemplate = {
      ...baseTemplate,
      blocks: [
        { type: 'bullet', content: 'A' },
        { type: 'bullet', content: 'B' },
        { type: 'bullet', content: 'C' },
      ]
    }
    const drafts = TemplateRenderer.render(multiTemplate, baseContext, baseAnchor)
    const ids = drafts.map(d => d.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })

  test('render 使用 anchor 的 pageId 和 parentId', () => {
    const customAnchor: Block = {
      ...baseAnchor,
      pageId: 'custom-page',
      parentId: 'custom-parent'
    }
    const drafts = TemplateRenderer.render(baseTemplate, baseContext, customAnchor)
    for (const d of drafts) {
      expect(d.pageId).toBe('custom-page')
    }
    // 第一个 draft 的 parentId 应该是 anchor 的 parentId
    expect(drafts[0].parentId).toBe('custom-parent')
  })
})

// ─── 更多边界情况和安全性测试 ─────────────────────────────────

describe('TemplateRenderer - additional edge cases', () => {
  const baseContext: TemplateContext = {
    date: '2026年6月5日',
    time: '14:30',
    isoDate: '2026-06-05',
    pageTitle: 'My Page',
    cursor: '__CURSOR__',
    clipboard: 'clip-text',
    now: 1718000000000,
  }

  const baseAnchor: Block = {
    id: 'anchor', pageId: 'page-1', parentId: null, pos: 1000,
    content: 'anchor', format: {}, type: 'bullet',
    properties: {}, createdAt: 0, updatedAt: 0
  }

  test('expandContent 处理特殊字符', () => {
    const result = TemplateRenderer.expandContent('{{date}} <script>alert(1)</script>', baseContext)
    expect(result.text).toContain('<script>alert(1)</script>')
    // 不应对 HTML 进行转义
  })

  test('expandContent 处理换行符', () => {
    const result = TemplateRenderer.expandContent('line1\nline2\n{{date}}', baseContext)
    expect(result.text).toBe('line1\nline2\n2026年6月5日')
  })

  test('expandContent 处理 Unicode 字符', () => {
    const result = TemplateRenderer.expandContent('你好世界 🎉 {{date}}', baseContext)
    expect(result.text).toBe('你好世界 🎉 2026年6月5日')
  })

  test('expandContent 处理超长变量名', () => {
    const result = TemplateRenderer.expandContent('{{very_long_variable_name_that_does_not_exist}}', baseContext)
    expect(result.text).toBe('{{very_long_variable_name_that_does_not_exist}}')
  })

  test('expandContent 处理相邻变量', () => {
    const result = TemplateRenderer.expandContent('{{date}}{{time}}{{iso_date}}', baseContext)
    expect(result.text).toBe('2026年6月5日14:302026-06-05')
  })

  test('expandContent 处理变量在字符串中间', () => {
    const result = TemplateRenderer.expandContent('prefix{{date}}middle{{time}}suffix', baseContext)
    expect(result.text).toBe('prefix2026年6月5日middle14:30suffix')
  })

  test('render 处理仅含 cursor 的模板', () => {
    const template: NormalizedTemplate = {
      id: 'cursor-only',
      name: 'Cursor Only',
      category: 'test',
      description: 'test',
      icon: '📝',
      source: 'builtin',
      blocks: [{ type: 'bullet', content: '{{cursor}}' }],
    }
    const drafts = TemplateRenderer.render(template, baseContext, baseAnchor)
    expect(drafts.length).toBe(1)
    expect(drafts[0].content).toBe('')
    expect(drafts[0].cursorMarker).toBe('__CURSOR__')
  })

  test('render 处理 heading level 边界值', () => {
    const template: NormalizedTemplate = {
      id: 'heading-test',
      name: 'Heading Test',
      category: 'test',
      description: 'test',
      icon: '📝',
      source: 'builtin',
      blocks: [
        { type: 'heading', content: 'H1', headingLevel: 1 },
        { type: 'heading', content: 'H2', headingLevel: 2 },
        { type: 'heading', content: 'H3', headingLevel: 3 },
      ],
    }
    const drafts = TemplateRenderer.render(template, baseContext, baseAnchor)
    expect(drafts[0].format).toEqual({ type: 'heading', level: 1 })
    expect(drafts[1].format).toEqual({ type: 'heading', level: 2 })
    expect(drafts[2].format).toEqual({ type: 'heading', level: 3 })
  })

  test('render 处理 property key 含特殊字符', () => {
    const template: NormalizedTemplate = {
      id: 'prop-special',
      name: 'Prop Special',
      category: 'test',
      description: 'test',
      icon: '📝',
      source: 'builtin',
      blocks: [{ type: 'property', propertyKey: '键-值.测试', content: 'value' }],
    }
    const drafts = TemplateRenderer.render(template, baseContext, baseAnchor)
    expect(drafts[0].content).toBe('键-值.测试:: value')
    expect(drafts[0].type).toBe('property')
  })

  test('render 处理 content 为空字符串', () => {
    const template: NormalizedTemplate = {
      id: 'empty-content',
      name: 'Empty Content',
      category: 'test',
      description: 'test',
      icon: '📝',
      source: 'builtin',
      blocks: [
        { type: 'bullet', content: '' },
        { type: 'heading', content: '', headingLevel: 2 },
        { type: 'property', propertyKey: 'key', content: '' },
      ],
    }
    const drafts = TemplateRenderer.render(template, baseContext, baseAnchor)
    expect(drafts.length).toBe(3)
    expect(drafts[0].content).toBe('')
    expect(drafts[1].content).toBe('')
    expect(drafts[2].content).toBe('key:: ')
  })

  test('render 处理超大 pos 值', () => {
    const largePosAnchor: Block = { ...baseAnchor, pos: 1000000 }
    const template: NormalizedTemplate = {
      id: 'large-pos',
      name: 'Large Pos',
      category: 'test',
      description: 'test',
      icon: '📝',
      source: 'builtin',
      blocks: [
        { type: 'bullet', content: 'A' },
        { type: 'bullet', content: 'B' },
      ],
    }
    const drafts = TemplateRenderer.render(template, baseContext, largePosAnchor)
    // basePos = anchor.pos + 1000 = 1001000
    expect(drafts[0].pos).toBe(1001000)
    expect(drafts[1].pos).toBe(1001000 + 1000)
  })

  test('render 处理 blocks 数组顺序保持 DFS', () => {
    const template: NormalizedTemplate = {
      id: 'dfs-order',
      name: 'DFS Order',
      category: 'test',
      description: 'test',
      icon: '📝',
      source: 'builtin',
      blocks: [
        { type: 'bullet', content: '1' },
        { type: 'bullet', content: '2', children: [
          { type: 'bullet', content: '2.1' },
          { type: 'bullet', content: '2.2', children: [
            { type: 'bullet', content: '2.2.1' },
          ] },
        ] },
        { type: 'bullet', content: '3' },
      ],
    }
    const drafts = TemplateRenderer.render(template, baseContext, baseAnchor)
    expect(drafts.map(d => d.content)).toEqual(['1', '2', '2.1', '2.2', '2.2.1', '3'])
  })

  test('buildContext 返回的 date 格式正确', async () => {
    const ctx = await TemplateRenderer.buildContext('Test')
    // 格式应为 YYYY年M月D日
    expect(ctx.date).toMatch(/^\d{4}年\d{1,2}月\d{1,2}日$/)
  })

  test('buildContext 返回的 time 格式正确', async () => {
    const ctx = await TemplateRenderer.buildContext('Test')
    // 格式应为 HH:MM
    expect(ctx.time).toMatch(/^\d{2}:\d{2}$/)
  })

  test('buildContext 返回的 isoDate 格式正确', async () => {
    const ctx = await TemplateRenderer.buildContext('Test')
    // 格式应为 YYYY-MM-DD
    expect(ctx.isoDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('buildContext 返回的 now 是有效时间戳', async () => {
    const ctx = await TemplateRenderer.buildContext('Test')
    expect(typeof ctx.now).toBe('number')
    expect(ctx.now).toBeGreaterThan(0)
    // 应该接近当前时间
    expect(Math.abs(ctx.now - Date.now())).toBeLessThan(1000)
  })
})
