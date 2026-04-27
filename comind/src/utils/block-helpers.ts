import type { Block } from '../types/block'

/**
 * Block 排序工具
 *
 * 使用 Gap 整数排序（pos 字段）：
 * - 初始间隔 1000，预留足够的插入空间
 * - 排序只需 a.pos - b.pos，O(n log n)
 * - 插入取中间值 (prev.pos + next.pos) / 2
 * - 只有间隔耗尽时才需要重编号
 */

/** Gap 排序的初始间隔 */
export const GAP_SIZE = 1000

/** ProseMirror 光标位置转换工具 */
export function pmPosToTextOffset(pmPos: number): number {
  return Math.max(0, pmPos - 1)
}

export function textOffsetToPmPos(textOffset: number): number {
  return textOffset + 1
}

/**
 * 按 pos 排序（原地排序）
 */
export function sortByPos<T extends { pos: number }>(items: T[]): T[] {
  return items.sort((a, b) => a.pos - b.pos)
}

/**
 * 获取指定父节点下的排序后的子节点
 */
export function getSortedChildren(
  blocks: Block[],
  parentId: string | null,
  pageId: string,
  excludeId?: string
): Block[] {
  return blocks
    .filter(b =>
      b.parentId === parentId &&
      b.pageId === pageId &&
      b.id !== excludeId
    )
    .sort((a, b) => a.pos - b.pos)
}

/**
 * 获取指定 Block 的同级兄弟节点（排序后）
 */
export function getSortedSiblings(
  blocks: Block[],
  block: Block,
  excludeSelf: boolean = false
): Block[] {
  return blocks
    .filter(b =>
      b.parentId === block.parentId &&
      b.pageId === block.pageId &&
      (!excludeSelf || b.id !== block.id)
    )
    .sort((a, b) => a.pos - b.pos)
}

/**
 * 查找 Block 在排序兄弟中的索引位置
 */
export function findBlockIndex(sortedSiblings: Block[], blockId: string): number {
  return sortedSiblings.findIndex(b => b.id === blockId)
}

/**
 * 获取指定 Block 在排序兄弟中的前一个兄弟
 */
export function getPrevSibling(
  blocks: Block[],
  block: Block
): Block | undefined {
  const siblings = getSortedSiblings(blocks, block, false)
  const index = findBlockIndex(siblings, block.id)
  return index > 0 ? siblings[index - 1] : undefined
}

/**
 * 获取指定 Block 在排序兄弟中的后一个兄弟
 */
export function getNextSibling(
  blocks: Block[],
  block: Block
): Block | undefined {
  const siblings = getSortedSiblings(blocks, block, false)
  const index = findBlockIndex(siblings, block.id)
  return index < siblings.length - 1 ? siblings[index + 1] : undefined
}

/**
 * 计算插入位置的 pos 值
 * @param prevPos 前一个节点的 pos（null 表示在开头）
 * @param nextPos 后一个节点的 pos（null 表示在末尾）
 * @returns 新节点的 pos 值
 */
export function calcInsertPos(prevPos: number | null, nextPos: number | null): number {
  if (prevPos === null && nextPos === null) {
    return GAP_SIZE
  }
  if (prevPos === null) {
    return nextPos! - GAP_SIZE
  }
  if (nextPos === null) {
    return prevPos + GAP_SIZE
  }
  const mid = (prevPos + nextPos) / 2
  if (mid === prevPos || mid === nextPos) {
    console.warn('[calcInsertPos] Gap exhausted, renumbering needed')
  }
  return mid
}

/**
 * 重新编号（当间隔耗尽时）
 */
export function renumberBlocks(blocks: Block[]): void {
  const sorted = sortByPos([...blocks])
  sorted.forEach((block, index) => {
    block.pos = (index + 1) * GAP_SIZE
  })
}

/** 防抖保存的延迟时间（毫秒） */
export const SAVE_DEBOUNCE_MS = 300
