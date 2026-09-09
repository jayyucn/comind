import { describe, it, expect } from 'vitest'
import { useContentRenderer } from '../../composables/useContentRenderer'
import type { RenderSegment } from '../../wasm/types'

const { renderContentToHtml } = useContentRenderer()

/**
 * 提取渲染态 HTML 中 .date-ref span 的可见文本。
 * DOMParser 自动反转义实体，得到与编辑态装饰一致的纯文本。
 */
function dateRefSpanText(content: string, segments: RenderSegment[]): string {
  const html = renderContentToHtml({ content, segments, blockId: '' })
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const span = doc.querySelector('.date-ref')
  expect(span).not.toBeNull()
  return span?.textContent ?? ''
}

/**
 * 构造「date_ref 段 + 前后 text 段」的 segments（与 Rust 返回结构一致）。
 * start/end 是 UTF-16 码元索引（Rust byte_to_utf16_idx 语义，emoji 占 2 码元）。
 */
function segmentsWithDateRef(
  content: string,
  start: number,
  end: number,
  kind = 'schedule',
): RenderSegment[] {
  const segs: RenderSegment[] = []
  if (start > 0) segs.push({ type: 'text', start: 0, end: start })
  segs.push({
    type: 'date_ref',
    start,
    end,
    kind,
    iso: '2026-09-08T00:00',
    recurrence: 'none',
    lead_minutes: 0,
    is_overdue: false,
  })
  if (end < content.length) segs.push({ type: 'text', start: end, end: content.length })
  return segs
}

describe('date_ref 渲染态切片（UTF-16 码元索引）', () => {
  // 背景：seg.start/end 是 Rust 端 byte_to_utf16_idx 返回的 UTF-16 码元索引
  // （emoji 占 2 码元）。渲染态必须精确等于 content.slice(start, end)，
  // 不吞不漏单元外字符。旧实现用 Array.from().slice() 按 Unicode 码点切，
  // 单元内嵌 emoji 时码点/码元单位错位，会把 emoji 之后的字符吞进单元。

  it('schedule 单元内嵌 📅，后跟数字：不吞数字', () => {
    const content = '@2026-09-08 📅1'
    const segs = segmentsWithDateRef(content, 0, 14)
    expect(dateRefSpanText(content, segs)).toBe('@2026-09-08 📅')
  })

  it('schedule 单元内嵌 📅，后跟中日文：不吞中文', () => {
    const content = '@2026-09-08 📅明天'
    const segs = segmentsWithDateRef(content, 0, 14)
    expect(dateRefSpanText(content, segs)).toBe('@2026-09-08 📅')
  })

  it('schedule 单元内嵌 📅，后跟 emoji：不吞 emoji', () => {
    const content = '@2026-09-08 📅🎉'
    const segs = segmentsWithDateRef(content, 0, 14)
    expect(dateRefSpanText(content, segs)).toBe('@2026-09-08 📅')
  })

  it('deadline 单元内嵌 ⏰ + |参数，后跟文本：不吞参数后字符', () => {
    // ⏰(U+23F0) 是 BMP 字符，占 1 个 UTF-16 码元（区别于 astral 的 📅 占 2 码元）
    const content = '@2026-09-08 ⏰||30 后'
    const segs = segmentsWithDateRef(content, 0, 17, 'deadline')
    expect(dateRefSpanText(content, segs)).toBe('@2026-09-08 ⏰||30')
  })

  it('ref 单元（无 emoji，end=11）+ 尾部 emoji：单元不含尾部 emoji', () => {
    const content = '@2026-09-08 📅'
    const segs = segmentsWithDateRef(content, 0, 11, 'ref')
    expect(dateRefSpanText(content, segs)).toBe('@2026-09-08')
  })

  it('ASCII schedule + |参数：不回归', () => {
    const content = '@2026-07-15|weekly rest'
    const segs = segmentsWithDateRef(content, 0, 18)
    expect(dateRefSpanText(content, segs)).toBe('@2026-07-15|weekly')
  })
})
