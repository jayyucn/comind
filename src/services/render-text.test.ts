import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { segmentVisibleText, renderedOffsetToEncodedOffset } from './render-text'
import type { RenderSegment } from '../wasm/types'
import { useRelationshipTypes } from '../composables/useRelationshipTypes'
import { cleanupRelationshipTypes } from '../../tests/core-client'

/**
 * #93：几何按「渲染文本」给偏移，切片按「存储 content（encoded）」切。
 * 本文件锁住两者之间的换算。typed_link 的 label（中文）与 type（英文）
 * 长度不同，必须先把关系类型表加载进来，否则 label 回退成原文、Δ 消失。
 */
beforeEach(async () => {
  await cleanupRelationshipTypes()
  const { _resetForTest, load } = useRelationshipTypes()
  _resetForTest()
  await load()
})

afterEach(async () => {
  await cleanupRelationshipTypes()
  const { _resetForTest } = useRelationshipTypes()
  _resetForTest()
})

const text = (start: number, end: number): RenderSegment => ({ type: 'text', start, end })

const link = (start: number, end: number, display: string): RenderSegment => ({
  type: 'link',
  start,
  end,
  target_page_title: '项目A',
  display_text: display,
})

/** Rust 把 `((is-a))[[项目A]]` 整体作为一个 typed_link 段吐出 */
const typedLink = (start: number, end: number): RenderSegment => ({
  type: 'typed_link',
  start,
  end,
  target_page_title: '项目A',
  display_text: '项目A',
  relationship_type: 'is-a',
  rel_label: '是一个',
  rel_color: '#888888',
})

describe('segmentVisibleText — 每个段在界面上显示成什么', () => {
  it('text 段里的别名链接折叠为 [[别名]]（渲染器同一条隐藏规则）', () => {
    const content = 'x[[项目A|别名]]y'
    expect(segmentVisibleText(content, text(1, 11))).toBe('[[别名]]')
  })

  it('text 段普通文字原样', () => {
    expect(segmentVisibleText('普通文字', text(0, 4))).toBe('普通文字')
  })

  it('link 段 = [[display_text]]', () => {
    const content = '[[项目A|别名]]'
    expect(segmentVisibleText(content, link(0, 10, '别名'))).toBe('[[别名]]')
  })

  it('typed_link 段 = ((label))[[display_text]]，label 长度 ≠ type 长度', () => {
    const content = '((is-a))[[项目A]]'
    const visible = segmentVisibleText(content, typedLink(0, 15))
    expect(visible).toBe('((是一个))[[项目A]]')
    expect(visible.length).not.toBe(content.length)
  })

  it('date_ref 段显示原文，长度与存储一致', () => {
    const content = '[[2026-09-13]]'
    const seg: RenderSegment = {
      type: 'date_ref',
      start: 0,
      end: 14,
      kind: 'date',
      iso: '2026-09-13',
      recurrence: '',
      lead_minutes: 0,
      is_overdue: false,
    }
    expect(segmentVisibleText(content, seg)).toBe('[[2026-09-13]]')
  })

  it('external_link 段显示 url', () => {
    const content = 'https://example.com'
    const seg: RenderSegment = { type: 'external_link', start: 0, end: 19, url: 'https://example.com' }
    expect(segmentVisibleText(content, seg)).toBe('https://example.com')
  })
})

describe('renderedOffsetToEncodedOffset — 渲染偏移 → encoded 偏移', () => {
  it('无 segments（纯文本块）→ 恒等', () => {
    expect(renderedOffsetToEncodedOffset('abc', undefined, 2)).toBe(2)
    expect(renderedOffsetToEncodedOffset('abc', [], 3)).toBe(3)
  })

  it('端点落在标记之前的普通文字上：按累积渲染长度换算（本次要修的错位）', () => {
    const content = '前((is-a))[[项目A]]尾'
    const segments = [text(0, 1), typedLink(1, 16), text(16, 17)]
    // 渲染文本 = '前' + '((是一个))[[项目A]]' + '尾'，'尾' 落在渲染偏移 15
    expect(renderedOffsetToEncodedOffset(content, segments, 1)).toBe(1)
    expect(renderedOffsetToEncodedOffset(content, segments, 15)).toBe(16)
    expect(renderedOffsetToEncodedOffset(content, segments, 16)).toBe(17)
  })

  it('别名链接之后同理（link 段的 display_text 比 encoded 短）', () => {
    const content = 'x[[项目A|别名]]y'
    const segments = [text(0, 1), link(1, 11, '别名'), text(11, 12)]
    // 渲染文本 = 'x' + '[[别名]]' + 'y'
    expect(renderedOffsetToEncodedOffset(content, segments, 1)).toBe(1)
    expect(renderedOffsetToEncodedOffset(content, segments, 7)).toBe(11)
    expect(renderedOffsetToEncodedOffset(content, segments, 8)).toBe(12)
  })

  it('端点落在标记内部：吸附到整段边界（左半→起点，右半→终点）', () => {
    const content = '((is-a))[[项目A]]'
    const segments = [typedLink(0, 15)]
    expect(renderedOffsetToEncodedOffset(content, segments, 3)).toBe(0)
    expect(renderedOffsetToEncodedOffset(content, segments, 10)).toBe(15)

    const aliased = '[[项目A|别名]]'
    const aliasSegments = [link(0, 10, '别名')]
    expect(renderedOffsetToEncodedOffset(aliased, aliasSegments, 1)).toBe(0)
    expect(renderedOffsetToEncodedOffset(aliased, aliasSegments, 5)).toBe(10)
  })

  it('越界钳制到内容末尾', () => {
    const content = '((is-a))[[项目A]]'
    expect(renderedOffsetToEncodedOffset(content, [typedLink(0, 15)], 999)).toBe(15)
  })
})

/**
 * 兜底路径：别名链接落在 text 段里（Rust 未生成 link 段），
 * 或整块拿不到 segments（links 表缺记录的旧数据）。
 * 吸附单位必须是「标记」而非「段」—— 否则段内正常文字会被整段吞掉。
 */
describe('renderedOffsetToEncodedOffset — 别名链接落在 text 段内', () => {
  // 存储 `x[[项目A|别名]]y`（12 字），渲染 `x[[别名]]y`（8 字）
  const content = 'x[[项目A|别名]]y'
  const segments: RenderSegment[] = [text(0, 12)]

  it('段内明文仍逐字对应', () => {
    expect(renderedOffsetToEncodedOffset(content, segments, 1)).toBe(1)
    expect(renderedOffsetToEncodedOffset(content, segments, 7)).toBe(11)
    expect(renderedOffsetToEncodedOffset(content, segments, 8)).toBe(12)
  })

  it('段内标记按标记边界吸附，不吞掉段内其它文字', () => {
    // 渲染偏移 3 = 别名首字之前（标记左半）→ 标记首
    expect(renderedOffsetToEncodedOffset(content, segments, 3)).toBe(1)
    // 渲染偏移 4 = 别名首字之后（标记右半）→ 标记尾
    expect(renderedOffsetToEncodedOffset(content, segments, 4)).toBe(11)
  })

  it('拿不到 segments 时同样按标记切分（纯文本下与恒等一致）', () => {
    expect(renderedOffsetToEncodedOffset(content, undefined, 7)).toBe(11)
    expect(renderedOffsetToEncodedOffset('abc', undefined, 2)).toBe(2)
    expect(renderedOffsetToEncodedOffset('abc', [], 99)).toBe(3)
  })
})
