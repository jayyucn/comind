import type { RenderSegment } from '../wasm/types'
import { getRelationshipLabel } from '../types/relationship'
import { parseRelationshipSegment } from '../utils/relationship-content'

/**
 * 渲染文本 ↔ 存储文本（encoded）的字符单位换算（#93 / ADR-0035 开放问题 #1）。
 *
 * 背景：`blockOffsetFromPoint` 以「界面渲染出来的文字」为基准给偏移，
 * 而 `textRangeToText` 切的是 `block.content`（encoded 存储原文）。
 * 纯文本块两者一致；含 `typed_link` / 带别名的 `link` 时，界面上隐藏了
 * `((type))` 的类型名与 `[[target|display]]` 的 target，长度不同 → 偏移错位。
 *
 * 界面上隐藏了什么、显示哪一段，是与渲染器共用的同一份规则
 * （`WIKI_LINK_REGEX` / `wikiLinkDisplay` / `resolveRelationshipLabel`），
 * 渲染器直接 import 使用，避免两处知识各自漂移。
 * 段的「版式拼接」（`[[ ]]`、`(( ))` 的具体排布）仍各写一份，
 * 由 `useContentRenderer.test.ts` 的一致性用例钉住：改渲染布局会立即变红。
 */

/**
 * Wiki link 语法：[[target]] 或 [[target|display]]。
 * 与 `useContentRenderer` 的兜底渲染共用同一份正则（文本段里也可能出现链接）。
 */
export const WIKI_LINK_REGEX = /\[\[([^[\]]+?)(?:\|([^[\]]+?))?\]\]/g

/** wiki link 在界面上显示哪一段：有别名显示别名，否则显示目标 */
export function wikiLinkDisplay(target: string, display?: string): string {
  return display ?? target
}

/**
 * 关系类型 → 界面标签（支持 `<->` 双向与 `!` auto-inverse）。
 * 未知类型回退原文，避免半转换。
 */
export function resolveRelationshipLabel(relType: string): string {
  const parts = parseRelationshipSegment(relType)
  const label = getRelationshipLabel(parts.type)
  if (parts.inverse !== undefined) {
    const invLabel = getRelationshipLabel(parts.inverse)
    // 未知反向类型时回退原文，避免半转换
    if (invLabel === parts.inverse) return relType
    return `${label}<->${invLabel}`
  }
  if (parts.autoInverse) {
    // 未知正向类型时回退原文
    if (label === parts.type) return relType
    return `${label}!`
  }
  // 未知类型回退原文
  return label === parts.type ? relType : label
}

/**
 * `[[target|display]]` → `[[display]]`。
 * 把「别名之外的部分不显示」这条规则收敛到一处（文本段兜底渲染也走它）。
 */
/** `[[target|display]]` → `[[display]]`：把「别名之外的部分不显示」这条规则收敛到一处 */
function collapseWikiLinkAlias(text: string): string {
  return text.replace(
    WIKI_LINK_REGEX,
    (_match: string, target: string, display?: string) => `[[${wikiLinkDisplay(target, display)}]]`,
  )
}

/** 单个段在界面上的可见纯文本（不含 HTML 标签；实体转义不影响 DOM textContent） */
export function segmentVisibleText(content: string, seg: RenderSegment): string {
  switch (seg.type) {
    case 'text':
      return collapseWikiLinkAlias(content.slice(seg.start, seg.end))
    case 'link':
      return `[[${seg.display_text}]]`
    case 'typed_link':
      return `((${resolveRelationshipLabel(seg.relationship_type)}))[[${seg.display_text}]]`
    case 'external_link':
      return seg.url
    case 'date_ref':
      // 渲染器直接显示存储原文，长度天然一致
      return content.slice(seg.start, seg.end)
    case 'tag':
      // inline `#foo` chip：显示存储原文（含 # 号），长度天然一致
      return content.slice(seg.start, seg.end)
  }
}

/**
 * 段内可映射单元。
 * - 明文单元：可见长度 ≡ 存储长度，逐字对应；
 * - 标记单元（可见长度 ≠ 存储长度，如 `[[项目A|别名]]`）：整个吸附。
 * 单位取「标记」而非「段」——text 段里可能夹着别名链接（Rust 未生成 link
 * 段时的兜底），若按段吸附，段内正常文字会被整段吞掉。
 */
interface VisibleUnit {
  visibleLen: number
  encodedStart: number
  encodedEnd: number
}

/** 与 `WIKI_LINK_REGEX` 同源（避免复用带 lastIndex 的全局对象），用于切分 text 段 */
const UNIT_SPLIT_REGEX = new RegExp(WIKI_LINK_REGEX.source, 'g')

/** 把 text 段切成「明文 run」与「wiki link 标记」两类单元 */
function textUnits(content: string, seg: RenderSegment): VisibleUnit[] {
  const raw = content.slice(seg.start, seg.end)
  const units: VisibleUnit[] = []
  let last = 0

  UNIT_SPLIT_REGEX.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = UNIT_SPLIT_REGEX.exec(raw)) !== null) {
    if (match.index > last) {
      units.push({
        visibleLen: match.index - last,
        encodedStart: seg.start + last,
        encodedEnd: seg.start + match.index,
      })
    }
    units.push({
      visibleLen: `[[${wikiLinkDisplay(match[1], match[2])}]]`.length,
      encodedStart: seg.start + match.index,
      encodedEnd: seg.start + match.index + match[0].length,
    })
    last = match.index + match[0].length
  }
  if (last < raw.length) {
    units.push({ visibleLen: raw.length - last, encodedStart: seg.start + last, encodedEnd: seg.end })
  }
  return units
}

/** 一个段切出的单元：text 段按标记细分，其余段整体作为一个单元 */
function unitsOf(content: string, seg: RenderSegment): VisibleUnit[] {
  if (seg.type === 'text') return textUnits(content, seg)
  return [
    { visibleLen: segmentVisibleText(content, seg).length, encodedStart: seg.start, encodedEnd: seg.end },
  ]
}

/** 在单元序列里定位渲染偏移；越界返回 null（由调用方钳制到内容末尾） */
function mapInUnits(units: VisibleUnit[], renderedOffset: number): number | null {
  let acc = 0
  for (const unit of units) {
    if (renderedOffset <= acc + unit.visibleLen) {
      const within = renderedOffset - acc
      const encodedLen = unit.encodedEnd - unit.encodedStart
      // 明文单元：逐字对应
      if (unit.visibleLen === encodedLen) return unit.encodedStart + within
      // 标记单元：按落点吸附到标记边界（左半→标记首，右半→标记尾）
      return within >= Math.ceil(unit.visibleLen / 2) ? unit.encodedEnd : unit.encodedStart
    }
    acc += unit.visibleLen
  }
  return null
}

/**
 * 界面渲染偏移 → 存储（encoded）偏移。
 *
 * - 明文按字对应；标记（`typed_link` / 带别名的 `link` / `external_link` /
 *   text 段里的别名链接）整体吸附，避免切出 `[[项目A|别` 这类残缺标记；
 * - 无 `segments`（纯文本块 / Rust 未提供分段的旧数据）→ 把整块当成一个 text 段
 *   切分：纯文本下与恒等一致，别名链接仍能正确吸附；
 * - 越界钳制到内容末尾。
 */
export function renderedOffsetToEncodedOffset(
  content: string,
  segments: RenderSegment[] | undefined,
  renderedOffset: number,
): number {
  const units =
    segments && segments.length > 0
      ? segments.flatMap(seg => unitsOf(content, seg))
      : textUnits(content, { type: 'text', start: 0, end: content.length })

  return mapInUnits(units, renderedOffset) ?? content.length
}
