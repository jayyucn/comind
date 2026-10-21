import type { Block } from '../types/block'
import { renderedOffsetToEncodedOffset } from './render-text'

/**
 * 文本选区纯计算模块（ADR-0035 D3/D5 的无 DOM 地基）。
 *
 * 给定一页的扁平 Block 列表 + 一个跨块文本范围，产出文档序归一化后的
 * 选区与要复制的文本。纯函数：无 store、无 DOM、无副作用，供后续
 * "内容区拖拽 = 连续文本选择"（#60）直接调用。
 */

/** 文本选区端点：blockId + 该 block 原文（encoded）的 UTF-16 码元偏移 */
export interface BlockOffset {
  blockId: string
  offset: number
}

/** 跨块文本范围：由锚点与焦点两个端点界定，保留方向性 */
export interface TextRange {
  anchor: BlockOffset
  head: BlockOffset
}

/**
 * 渲染文本坐标下的一个「内联原子单元」区间 [start, end)（UTF-16 码元）。
 * 单元的视觉边界由渲染层决定（`.block-tag` / `.date-ref` / `.block-link` 等），
 * 由 `selection-geometry.atomicUnitSpans` 从实时 DOM 量出。
 */
export interface RenderedUnitSpan {
  start: number
  end: number
}

/** 文档序归一化后的文本范围 */
export interface NormalizedTextRange {
  /** 文档序靠前的端点 */
  start: BlockOffset
  /** 文档序靠后的端点 */
  end: BlockOffset
  /** 文档序上严格介于 start 与 end 之间的整块 id（首尾本身除外） */
  middleBlockIds: string[]
}

/**
 * 计算 blocks 的文档序（预序 DFS）id 序列。
 *
 * 根 = `parentId` 为 null 或 `parentId` 不在本列表中的 block——兼容
 * "根块在列表中"（根块 parentId=null）与"根块已过滤"（顶层块的 parentId
 * 指向不在此列表的根块）两种调用方式，与渲染树一致。
 */
function documentOrderIds(blocks: Block[]): string[] {
  const ids = new Set(blocks.map(b => b.id))
  const byParent = new Map<string, Block[]>()
  const roots: Block[] = []

  for (const b of blocks) {
    if (b.parentId === null || !ids.has(b.parentId)) {
      roots.push(b)
    } else {
      const list = byParent.get(b.parentId) ?? []
      list.push(b)
      byParent.set(b.parentId, list)
    }
  }

  roots.sort((a, b) => a.pos - b.pos)
  for (const list of byParent.values()) {
    list.sort((a, b) => a.pos - b.pos)
  }

  const out: string[] = []
  const walk = (id: string): void => {
    out.push(id)
    for (const c of byParent.get(id) ?? []) walk(c.id)
  }
  for (const r of roots) walk(r.id)
  return out
}

/** 按文档序把 anchor/head 归一化为 start/end，并给出中间整块 id */
export function normalizeTextRange(blocks: Block[], range: TextRange): NormalizedTextRange {
  const order = documentOrderIds(blocks)
  const index = new Map(order.map((id, i) => [id, i]))

  const anchorIdx = index.get(range.anchor.blockId)
  const headIdx = index.get(range.head.blockId)

  if (anchorIdx === undefined || headIdx === undefined) {
    // 端点不在给定 blocks 中：调用方负责保证端点有效，此处返回退化结果
    return { start: range.anchor, end: range.head, middleBlockIds: [] }
  }

  let start: BlockOffset
  let end: BlockOffset
  if (anchorIdx < headIdx) {
    start = range.anchor
    end = range.head
  } else if (anchorIdx > headIdx) {
    start = range.head
    end = range.anchor
  } else {
    // 同一 block：按 offset 归一化，保证 start.offset <= end.offset
    if (range.anchor.offset <= range.head.offset) {
      start = range.anchor
      end = range.head
    } else {
      start = range.head
      end = range.anchor
    }
  }

  const lo = Math.min(anchorIdx, headIdx)
  const hi = Math.max(anchorIdx, headIdx)
  const middleBlockIds = order.slice(lo + 1, hi)

  return { start, end, middleBlockIds }
}

/**
 * 复制文本：首尾按 offset 切片 + 中间整块，块间 '\n' 连接。
 * 非文本块（image/code/heading 等）沿用其 content 的现有表示。
 *
 * 端点 offset 来自界面渲染文本（含隐藏了类型名/target 的内联标记），
 * 而本函数切的是存储原文（encoded）——先经 `renderedOffsetToEncodedOffset`
 * 换算，否则含标记的块上会错位（#93 / ADR-0035 开放问题 #1）。
 */
export function textRangeToText(blocks: Block[], range: TextRange): string {
  const { start, end, middleBlockIds } = normalizeTextRange(blocks, range)
  const byId = new Map(blocks.map(b => [b.id, b]))
  const startBlock = byId.get(start.blockId)
  const endBlock = byId.get(end.blockId)
  if (!startBlock || !endBlock) return ''

  // 换算内部已按 content 长度钳制
  const lo = renderedOffsetToEncodedOffset(startBlock.content, startBlock.renderSegments, start.offset)
  const hi = renderedOffsetToEncodedOffset(endBlock.content, endBlock.renderSegments, end.offset)

  if (start.blockId === end.blockId) {
    // normalizeTextRange 已保证 start.offset <= end.offset，换算保持单调
    return startBlock.content.slice(lo, hi)
  }

  const parts: string[] = []
  parts.push(startBlock.content.slice(lo))
  for (const id of middleBlockIds) {
    const b = byId.get(id)
    if (b) parts.push(b.content)
  }
  parts.push(endBlock.content.slice(0, hi))
  return parts.join('\n')
}

/**
 * 端点若严格落在某个原子单元内部，吸附到该单元的**外侧**边界（扩张方向）。
 *
 * `side` 是端点在整个选区里的角色：起点往左扩（`start`）、终点往右扩（`end`）。
 * 两条都只会**扩大**选区，绝不收缩——原子单元要么整体入选、要么完全不入选。
 */
function snapOutward(
  offset: number,
  units: RenderedUnitSpan[],
  side: 'start' | 'end',
): number {
  for (const u of units) {
    if (offset > u.start && offset < u.end) return side === 'start' ? u.start : u.end
  }
  return offset
}

/**
 * 把文本选区两端吸附出内联原子单元（inline chip / date-ref / wiki link）。
 *
 * 为什么必须有这一层：跨块文本选区的端点是**渲染文本的字符偏移**，
 * 删除时由 `planTextRangeDeletion` 直接按该偏移切 `block.content`——
 * 端点落在 `#任务` 中间就会切出 `#任` 这种半截 chip（真机实证：右→左拖到
 * chip 中间按 Backspace，`vanished: ["务 后面"]`）。ProseMirror 侧的选区
 * 原子化管不到这条路径：拖拽超过 4px 时 BlockList 已 `deactivateBlock()`，
 * 编辑器根本不在场，删除完全由本模块的偏移驱动。
 *
 * 口径与 PM 侧 `createInlineUnitKeyboardPlugin` 的选区闸门一致：
 * **端点永不落在单元内部**，单元整体参与选区。端点不碰单元时原样返回。
 *
 * @param blocks 用于确定两端点的文档序（`normalizeTextRange` 同源）
 * @param range  待吸附的选区（渲染文本坐标）
 * @param unitsOf 取某 block 内全部原子单元区间（渲染文本坐标）
 */
export function snapTextRangeToUnits(
  blocks: Block[],
  range: TextRange,
  unitsOf: (blockId: string) => RenderedUnitSpan[],
): TextRange {
  const { start, end } = normalizeTextRange(blocks, range)
  // 折叠端点：没有可删内容，吸附会凭空造出选区，保持原样
  if (start.blockId === end.blockId && start.offset === end.offset) return range

  const nextStart = snapOutward(start.offset, unitsOf(start.blockId), 'start')
  const nextEnd = snapOutward(end.offset, unitsOf(end.blockId), 'end')
  if (nextStart === start.offset && nextEnd === end.offset) return range

  // 保持原选区的方向性（anchor/head 角色不因吸附而互换）：
  // shift+click 延伸依赖 anchor 仍是固定端。
  const anchorIsStart =
    range.anchor.blockId === start.blockId && range.anchor.offset === start.offset
  return {
    anchor: { ...range.anchor, offset: anchorIsStart ? nextStart : nextEnd },
    head: { ...range.head, offset: anchorIsStart ? nextEnd : nextStart },
  }
}
