/**
 * Block 正文行内格式（加粗 / 斜体 / 下划线 / 删除线 / 文字色 / 背景色）。
 *
 * 存储形态：`block.format.inlineMarks`，一组**互不重叠**的区间，偏移为 UTF-16 码元
 * （与 JS `String.prototype.slice` 同口径），相对 block.content。正文本身保持纯文本，
 * 因此 #tag / [[link]] / @日期 / 关系语法等既有解析链路完全不受影响。
 *
 * 色值只存调色板 token 名（与标签共用 `TAG_COLORS`），渲染时再落到 CSS 变量；
 * 所有来自存储的区间与色值都必须经本模块归一化/白名单，避免越界偏移与 CSS 注入。
 */
import { escapeHtml } from './mini-markdown'
import { isTagColorToken, TAG_COLORS } from './tag-color'

export interface InlineMarkAttrs {
  bold?: true
  italic?: true
  underline?: true
  strike?: true
  /** 文字色：调色板 token 名，如 `--tag-color-2` */
  color?: string
  /** 背景色：调色板 token 名 */
  background?: string
}

export interface InlineMarkRange extends InlineMarkAttrs {
  /** 起始 UTF-16 偏移（含） */
  start: number
  /** 结束 UTF-16 偏移（不含） */
  end: number
}

/** 文本变换区间（原坐标 ↔ 新坐标），与关系语法编解码共用。 */
export interface OffsetSpan {
  from: number
  to: number
  newFrom: number
  newTo: number
}

/** 调色板选项（与标签共用同一份色板，顺序即工具条展示顺序）。 */
export const INLINE_COLORS = TAG_COLORS

const ATTR_KEYS = ['bold', 'italic', 'underline', 'strike', 'color', 'background'] as const

function pickAttrs(source: InlineMarkAttrs): InlineMarkAttrs | null {
  const attrs: InlineMarkAttrs = {}
  for (const key of ATTR_KEYS) {
    const value = source[key]
    if (key === 'color' || key === 'background') {
      if (isTagColorToken(value)) attrs[key] = value
    } else if (value === true) {
      attrs[key] = true
    }
  }
  return Object.keys(attrs).length > 0 ? attrs : null
}

function sameAttrs(a: InlineMarkAttrs, b: InlineMarkAttrs): boolean {
  return ATTR_KEYS.every(key => a[key] === b[key])
}

/**
 * 归一化任意来源的区间：
 * - 丢弃非对象 / 空区间 / 无有效格式的项；
 * - 偏移截断到 [0, textLength]；
 * - 把重叠区间压平成互不重叠的连续段（同段内格式取并集），便于渲染与序列化。
 */
export function normalizeInlineMarks(raw: unknown, textLength: number): InlineMarkRange[] {
  if (!Array.isArray(raw) || textLength <= 0) return []

  const valid: InlineMarkRange[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const start = Math.max(0, Math.min(textLength, Math.trunc(Number(record.start))))
    const end = Math.max(0, Math.min(textLength, Math.trunc(Number(record.end))))
    if (!(end > start)) continue
    const attrs = pickAttrs(record as InlineMarkAttrs)
    if (!attrs) continue
    valid.push({ start, end, ...attrs })
  }
  if (valid.length === 0) return []

  const points = Array.from(new Set(valid.flatMap(mark => [mark.start, mark.end]))).sort((a, b) => a - b)
  const runs: InlineMarkRange[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i]
    const end = points[i + 1]
    const covering = valid.filter(mark => mark.start <= start && mark.end >= end)
    if (covering.length === 0) continue
    const attrs: InlineMarkAttrs = {}
    for (const mark of covering) Object.assign(attrs, pickAttrs(mark) ?? {})
    const previous = runs[runs.length - 1]
    if (previous && previous.end === start && sameAttrs(previous, attrs)) {
      previous.end = end
    } else {
      runs.push({ start, end, ...attrs })
    }
  }
  return runs
}

/** 从 block.format 读取并归一化行内格式。 */
export function readInlineMarks(
  format: Record<string, unknown> | null | undefined,
  textLength: number,
): InlineMarkRange[] {
  if (!format || typeof format !== 'object') return []
  return normalizeInlineMarks((format as { inlineMarks?: unknown }).inlineMarks, textLength)
}

/** 写回 block.format（返回新对象；空格式时移除键，保持存量 format 干净）。 */
export function writeInlineMarks(
  format: Record<string, unknown> | null | undefined,
  marks: InlineMarkRange[],
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(format ?? {}) }
  if (marks.length === 0) {
    delete next.inlineMarks
    return next
  }
  next.inlineMarks = marks.map(mark => ({ ...mark }))
  return next
}

/** 同格式区间是否等价（用于判断是否需要落库）。 */
export function sameInlineMarks(a: InlineMarkRange[], b: InlineMarkRange[]): boolean {
  if (a.length !== b.length) return false
  return a.every((mark, index) => {
    const other = b[index]
    return mark.start === other.start && mark.end === other.end && sameAttrs(mark, other)
  })
}

/** 取 [from, to) 范围内的区间，并平移到以 from 为 0 的坐标。 */
export function sliceInlineMarks(marks: InlineMarkRange[], from: number, to: number): InlineMarkRange[] {
  const sliced: InlineMarkRange[] = []
  for (const mark of marks) {
    const start = Math.max(mark.start, from)
    const end = Math.min(mark.end, to)
    if (end > start) sliced.push({ ...mark, start: start - from, end: end - from })
  }
  return sliced
}

/** 行内格式键（工具条动作口径） */
export type InlineMarkKey = 'bold' | 'italic' | 'underline' | 'strike' | 'color' | 'background'

/** 布尔型格式键 */
export type InlineBooleanMarkKey = 'bold' | 'italic' | 'underline' | 'strike'

/** [from, to) 是否被满足 predicate 的区间**完整**覆盖（不完整或为空 → false）。 */
function coversRange(
  runs: InlineMarkRange[],
  from: number,
  to: number,
  predicate: (attrs: InlineMarkRange) => boolean,
): boolean {
  if (to <= from) return false
  let cursor = from
  for (const run of runs) {
    if (run.end <= cursor) continue
    if (run.start > cursor) return false
    if (!predicate(run)) return false
    cursor = Math.min(run.end, to)
    if (cursor >= to) return true
  }
  return false
}

/** [from, to) 内每段文本都带某布尔格式（工具条激活态）。 */
export function rangeHasAttr(
  marks: InlineMarkRange[],
  from: number,
  to: number,
  key: InlineBooleanMarkKey,
  textLength: number,
): boolean {
  return coversRange(normalizeInlineMarks(marks, textLength), from, to, run => run[key] === true)
}

/** [from, to) 的颜色/背景色是否统一为同一 token（未全覆盖或不统一 → ''）。 */
export function rangeColorToken(
  marks: InlineMarkRange[],
  from: number,
  to: number,
  key: 'color' | 'background',
  textLength: number,
): string {
  let token = ''
  const ok = coversRange(normalizeInlineMarks(marks, textLength), from, to, (run) => {
    const value = run[key]
    if (!isTagColorToken(value)) return false
    if (!token) token = value
    return token === value
  })
  return ok ? token : ''
}

/**
 * 重写 [from, to) 内的格式：区间外的区间原样保留，区间内按子段应用 mutate。
 * 子段粒度来自既有区间边界——未被任何区间覆盖的空隙也算子段（满足 mutate 后独立成段）。
 */
function rewriteRange(
  marks: InlineMarkRange[],
  from: number,
  to: number,
  mutate: (attrs: InlineMarkAttrs) => InlineMarkAttrs,
  textLength: number,
): InlineMarkRange[] {
  if (to <= from) return normalizeInlineMarks(marks, textLength)

  const out: InlineMarkRange[] = []
  const inside: InlineMarkRange[] = []
  for (const mark of marks) {
    const start = Math.max(mark.start, from)
    const end = Math.min(mark.end, to)
    if (end <= start) {
      out.push({ ...mark })
      continue
    }
    if (mark.start < from) out.push({ ...mark, end: from })
    if (mark.end > to) out.push({ ...mark, start: to })
    inside.push({ ...mark, start, end })
  }

  const segmented: InlineMarkRange[] = []
  let cursor = from
  for (const mark of inside) {
    if (mark.start > cursor) segmented.push({ start: cursor, end: mark.start })
    segmented.push(mark)
    cursor = Math.max(cursor, mark.end)
  }
  if (cursor < to) segmented.push({ start: cursor, end: to })

  for (const seg of segmented) {
    const attrs = mutate(pickAttrs(seg) ?? {})
    if (Object.keys(attrs).length > 0) out.push({ start: seg.start, end: seg.end, ...attrs })
  }
  return normalizeInlineMarks(out, textLength)
}

/** 给 [from, to) 叠加格式（保留各子段已有的其它格式）。 */
export function setInlineMarkRange(
  marks: InlineMarkRange[],
  from: number,
  to: number,
  patch: InlineMarkAttrs,
  textLength: number,
): InlineMarkRange[] {
  return rewriteRange(marks, from, to, attrs => ({ ...attrs, ...patch }), textLength)
}

/** 从 [from, to) 移除指定格式。 */
export function clearInlineMarkRange(
  marks: InlineMarkRange[],
  from: number,
  to: number,
  keys: InlineMarkKey[],
  textLength: number,
): InlineMarkRange[] {
  return rewriteRange(marks, from, to, (attrs) => {
    const next = { ...attrs }
    for (const key of keys) delete next[key]
    return next
  }, textLength)
}

/** 整体平移偏移（合并块时把后块 marks 接到前块尾部）。 */
export function shiftInlineMarks(marks: InlineMarkRange[], delta: number): InlineMarkRange[] {
  if (delta === 0) return marks.map(mark => ({ ...mark }))
  return marks
    .map(mark => ({ ...mark, start: mark.start + delta, end: mark.end + delta }))
    .filter(mark => mark.end > 0)
}

/** 把偏移从一侧变换到另一侧（direction=toNew: from/to → newFrom/newTo）。 */
function mapOffset(offset: number, spans: OffsetSpan[], direction: 'toNew' | 'toOrig'): number {
  let delta = 0
  for (const span of spans) {
    const from = direction === 'toNew' ? span.from : span.newFrom
    const to = direction === 'toNew' ? span.to : span.newTo
    const newFrom = direction === 'toNew' ? span.newFrom : span.from
    const newTo = direction === 'toNew' ? span.newTo : span.to
    if (offset <= from) break
    if (offset >= to) {
      delta = newTo - to
      continue
    }
    const ratio = (offset - from) / (to - from)
    return Math.round(newFrom + ratio * (newTo - newFrom))
  }
  return offset + delta
}

/** 按文本变换区间映射行内格式偏移，并归一化到目标文本长度。 */
export function mapInlineMarkOffsets(
  marks: InlineMarkRange[],
  spans: OffsetSpan[],
  direction: 'toNew' | 'toOrig',
  targetLength: number,
): InlineMarkRange[] {
  if (spans.length === 0) return normalizeInlineMarks(marks, targetLength)
  return normalizeInlineMarks(
    marks.map(mark => ({
      ...mark,
      start: mapOffset(mark.start, spans, direction),
      end: mapOffset(mark.end, spans, direction),
    })),
    targetLength,
  )
}

/** 合并多个区间上的格式（用于非文本段被区间覆盖时的收口）。 */
export function mergeMarkAttrs(marks: InlineMarkRange[]): InlineMarkAttrs | null {
  if (marks.length === 0) return null
  const attrs: InlineMarkAttrs = {}
  for (const mark of marks) Object.assign(attrs, pickAttrs(mark) ?? {})
  return Object.keys(attrs).length > 0 ? attrs : null
}

/**
 * 用格式包裹一段**已渲染/已转义**的 HTML。
 * 色值在此处再次白名单校验；非法 token 不会进入 style 属性。
 */
export function wrapInlineHtml(html: string, attrs: InlineMarkAttrs): string {
  let out = html
  if (attrs.bold) out = `<strong>${out}</strong>`
  if (attrs.italic) out = `<em>${out}</em>`
  if (attrs.underline) out = `<u>${out}</u>`
  if (attrs.strike) out = `<s>${out}</s>`
  if (isTagColorToken(attrs.color)) {
    out = `<span data-inline-color="${attrs.color}" style="color: var(${attrs.color})">${out}</span>`
  }
  if (isTagColorToken(attrs.background)) {
    out = `<span data-inline-bg="${attrs.background}" style="background-color: color-mix(in srgb, var(${attrs.background}) 28%, transparent); border-radius: 2px">${out}</span>`
  }
  return out
}

function escapeText(text: string): string {
  return escapeHtml(text).replace(/\n/g, '<br>')
}

/**
 * 纯文本 + 行内格式 → 编辑器初始 HTML。
 * 同时输出 `data-inline-color` / `data-inline-bg`，供自定义 Mark 的 parseHTML 识别。
 */
export function inlineMarksToHtml(text: string, marks: InlineMarkRange[]): string {
  const normalized = normalizeInlineMarks(marks, text.length)
  if (normalized.length === 0) return escapeText(text)

  let html = ''
  let cursor = 0
  for (const mark of normalized) {
    if (mark.start > cursor) html += escapeText(text.slice(cursor, mark.start))
    html += wrapInlineHtml(escapeText(text.slice(mark.start, mark.end)), mark)
    cursor = mark.end
  }
  if (cursor < text.length) html += escapeText(text.slice(cursor))
  return html
}
