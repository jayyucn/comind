import type { BlockWithPos } from '../types/block'

/**
 * ProseMirror 光标位置转换工具
 *
 * ProseMirror 的位置系统包括节点标签开销：
 * - 空段落: <p>|</p> 位置 0-1
 * - 有文本: <p>|text</p> 位置 0-1-5 (位置 1 是文本开始)
 *
 * 因此，ProseMirror 位置 = 文本偏移量 + 1（段落开始标签开销）
 */

/** ProseMirror 位置转文本偏移量 */
export function pmPosToTextOffset(pmPos: number): number {
  return Math.max(0, pmPos - 1)
}

/** 文本偏移量转 ProseMirror 位置 */
export function textOffsetToPmPos(textOffset: number): number {
  return textOffset + 1
}

/**
 * 获取指定父节点下的排序后的子节点
 * @param blocks 所有 Block 列表
 * @param parentId 父节点 ID（null 表示顶层）
 * @param pageId 所属页面 ID
 * @param excludeId 排除的 Block ID（可选）
 */
export function getSortedChildren(
  blocks: BlockWithPos[],
  parentId: string | null,
  pageId: string,
  excludeId?: string
): BlockWithPos[] {
  return blocks
    .filter(b =>
      b.parentId === parentId &&
      b.pageId === pageId &&
      b.id !== excludeId
    )
    .sort((a, b) => {
      if (!a.leftId) return -1
      if (!b.leftId) return 1
      return a.leftId.localeCompare(b.leftId)
    })
}

/**
 * 获取指定 Block 的同级兄弟节点（排序后）
 * @param blocks 所有 Block 列表
 * @param block 目标 Block
 * @param excludeSelf 是否排除自身
 */
export function getSortedSiblings(
  blocks: BlockWithPos[],
  block: BlockWithPos,
  excludeSelf: boolean = false
): BlockWithPos[] {
  return blocks
    .filter(b =>
      b.parentId === block.parentId &&
      b.pageId === block.pageId &&
      (!excludeSelf || b.id !== block.id)
    )
    .sort((a, b) => {
      if (!a.leftId) return -1
      if (!b.leftId) return 1
      return a.leftId.localeCompare(b.leftId)
    })
}

/**
 * 按 leftId 排序（原地排序）
 */
export function sortByLeftId<T extends { leftId: string | null }>(items: T[]): T[] {
  return items.sort((a, b) => {
    if (!a.leftId) return -1
    if (!b.leftId) return 1
    return a.leftId.localeCompare(b.leftId)
  })
}

/**
 * 查找 Block 在排序兄弟中的索引位置
 * @param sortedSiblings 已排序的兄弟节点列表
 * @param blockId 目标 Block ID
 */
export function findBlockIndex(sortedSiblings: BlockWithPos[], blockId: string): number {
  return sortedSiblings.findIndex(b => b.id === blockId)
}

/**
 * 获取指定 Block 在排序兄弟中的前一个兄弟
 */
export function getPrevSibling(
  blocks: BlockWithPos[],
  block: BlockWithPos
): BlockWithPos | undefined {
  const siblings = getSortedSiblings(blocks, block, true)
  const index = findBlockIndex(siblings, block.id)
  return index > 0 ? siblings[index - 1] : undefined
}

/**
 * 获取指定 Block 在排序兄弟中的后一个兄弟
 */
export function getNextSibling(
  blocks: BlockWithPos[],
  block: BlockWithPos
): BlockWithPos | undefined {
  const siblings = getSortedSiblings(blocks, block, true)
  const index = findBlockIndex(siblings, block.id)
  return index < siblings.length - 1 ? siblings[index + 1] : undefined
}

/** 防抖保存的延迟时间（毫秒） */
export const SAVE_DEBOUNCE_MS = 300
