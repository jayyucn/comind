import type { Block } from '../types/block'

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

function clampOffset(offset: number, length: number): number {
  return Math.max(0, Math.min(offset, length))
}

/**
 * 复制文本：首尾按 offset 切片 + 中间整块，块间 '\n' 连接。
 * 非文本块（image/code/heading 等）沿用其 content 的现有表示。
 */
export function textRangeToText(blocks: Block[], range: TextRange): string {
  const { start, end, middleBlockIds } = normalizeTextRange(blocks, range)
  const byId = new Map(blocks.map(b => [b.id, b]))
  const startBlock = byId.get(start.blockId)
  const endBlock = byId.get(end.blockId)
  if (!startBlock || !endBlock) return ''

  if (start.blockId === end.blockId) {
    // normalizeTextRange 已保证 start.offset <= end.offset
    const lo = clampOffset(start.offset, startBlock.content.length)
    const hi = clampOffset(end.offset, startBlock.content.length)
    return startBlock.content.slice(lo, hi)
  }

  const parts: string[] = []
  parts.push(startBlock.content.slice(clampOffset(start.offset, startBlock.content.length)))
  for (const id of middleBlockIds) {
    const b = byId.get(id)
    if (b) parts.push(b.content)
  }
  parts.push(endBlock.content.slice(0, clampOffset(end.offset, endBlock.content.length)))
  return parts.join('\n')
}
