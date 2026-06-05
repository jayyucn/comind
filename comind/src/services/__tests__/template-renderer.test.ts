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
})
