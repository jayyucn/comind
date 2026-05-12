import type { Block } from '../types/block'
import { logger } from './logger'

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
 *
 * 使用 Gap 排序算法：
 * - 初始间隔 GAP_SIZE = 1000
 * - 插入取中间值 floor((prevPos + nextPos) / 2)
 * - 间隔耗尽时抛出错误，需调用方触发 renumberBlocks
 *
 * @param prevPos 前一个节点的 pos（null 表示在开头）
 * @param nextPos 后一个节点的 pos（null 表示在末尾）
 * @returns 新节点的 pos 值（保证为整数）
 * @throws {Error} 当间隔耗尽时（prevPos 与 nextPos 相邻）
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

  // 使用 Math.floor 确保结果为整数，避免浮点数累积误差
  const mid = Math.floor((prevPos + nextPos) / 2)

  // 检测间隔耗尽：当 mid 等于 prevPos 时，说明 prevPos 和 nextPos 之间已无空间
  if (mid === prevPos) {
    const error = new Error(
      `[calcInsertPos] Gap exhausted between pos ${prevPos} and ${nextPos}. ` +
      `Call renumberBlocks() to recover.`
    )
    error.name = 'GapExhaustedError'
    logger.error(error.message)
    throw error
  }

  return mid
}

/** 间隔耗尽错误类型 */
export class GapExhaustedError extends Error {
  readonly prevPos: number
  readonly nextPos: number

  constructor(prevPos: number, nextPos: number, message?: string) {
    super(
      message ??
      `Gap exhausted between pos ${prevPos} and ${nextPos}. Call renumberBlocks() to recover.`
    )
    this.name = 'GapExhaustedError'
    this.prevPos = prevPos
    this.nextPos = nextPos
  }
}

/**
 * 检测是否为间隔耗尽错误
 */
export function isGapExhaustedError(error: unknown): error is GapExhaustedError {
  return error instanceof GapExhaustedError ||
    (error instanceof Error && error.name === 'GapExhaustedError')
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
