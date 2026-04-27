import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Block } from '../types/block'
import { storage } from '../storage/indexedDB'
import { generateUUID } from '../utils/id'
import { debounce } from '../utils/debounce'
import { invalidateTagCache } from '../composables/useTagFilter'
import { usePageStore } from './pages'
import {
  pmPosToTextOffset,
  getSortedChildren,
  getSortedSiblings,
  sortByPos,
  getPrevSibling,
  getNextSibling,
  calcInsertPos,
  renumberBlocks,
  isGapExhaustedError,
  SAVE_DEBOUNCE_MS,
  findBlockIndex
} from '../utils/block-helpers'

/**
 * 安全计算插入位置，带自动重试机制
 *
 * 当间隔耗尽时自动触发重新编号，然后重试一次。
 * 如果重试后仍然失败，抛出错误。
 *
 * @param prevPos 前一个节点的 pos
 * @param nextPos 后一个节点的 pos
 * @param blocksRef Block 列表引用（用于重新编号）
 * @param storageRef 存储引用（用于持久化重新编号结果）
 * @returns 新节点的 pos 值
 */
async function safeCalcInsertPos(
  prevPos: number | null,
  nextPos: number | null,
  blocksRef: Block[],
  storageRef: typeof storage
): Promise<number> {
  try {
    return calcInsertPos(prevPos, nextPos)
  } catch (error) {
    if (isGapExhaustedError(error)) {
      console.warn('[safeCalcInsertPos] Gap exhausted, triggering renumbering...')
      
      // 重新编号所有 Block
      renumberBlocks(blocksRef)
      
      // 持久化重新编号结果
      for (const block of blocksRef) {
        await storageRef.saveBlock(block)
      }
      
      console.info('[safeCalcInsertPos] Renumbering complete, retrying insert...')
      
      // 重试计算（重新编号后应该有足够空间）
      // 注意：prevPos 和 nextPos 可能已改变，需要重新获取
      // 由于调用方已经计算好了 prevPos/nextPos，这里简单地重试
      // 如果仍然失败，说明有更严重的问题
      try {
        return calcInsertPos(prevPos, nextPos)
      } catch (retryError) {
        console.error('[safeCalcInsertPos] Retry failed after renumbering:', retryError)
        throw new Error(
          'Failed to calculate insert position even after renumbering. ' +
          'This indicates a serious data consistency issue.'
        )
      }
    }
    throw error
  }
}

export const useBlockStore = defineStore('blocks', () => {
  const blocks = ref<Block[]>([])
  const loading = ref(false)

  /** 按 pos 排序的扁平 Block 列表 */
  const sortedBlocks = computed(() => sortByPos([...blocks.value]))

  /** 构建 Block 树（parentId → children[]） */
  const blockTree = computed(() => {
    const map = new Map<string | null, Block[]>()
    for (const block of blocks.value) {
      const list = map.get(block.parentId) ?? []
      list.push(block)
      map.set(block.parentId, list)
    }
    // 每组按 pos 排序
    for (const [key, list] of map) {
      map.set(key, sortByPos(list))
    }
    return map
  })

  /** 获取某 Block 的直接子节点 */
  function getChildren(parentId: string): Block[] {
    return blockTree.value.get(parentId) ?? []
  }

  /** 加载指定 Page 的 Block 树 */
  async function loadPageBlocks(pageId: string) {
    blocks.value = await storage.getBlockTree(pageId)
    return blocks
  }

  /** 批量加载多个 Page 的 Block 树 */
  async function loadMultiPageBlocks(pageIds: string[]) {
    loading.value = true
    try {
      const results = await Promise.allSettled(
        pageIds.map(id => storage.getBlockTree(id))
      )

      const existingIds = new Set(blocks.value.map(b => b.id))
      for (const result of results) {
        if (result.status === 'fulfilled') {
          for (const block of result.value) {
            if (!existingIds.has(block.id)) {
              blocks.value.push(block)
              existingIds.add(block.id)
            }
          }
        } else {
          console.error('[loadMultiPageBlocks] Failed to load blocks:', result.reason)
        }
      }
    } catch (error) {
      console.error('[loadMultiPageBlocks] Unexpected error:', error)
    } finally {
      loading.value = false
    }
  }

  /** 每个 Block 独立的防抖保存 */
  const pendingSaves = new Map<string, ReturnType<typeof debounce<typeof _doSave>>>()

  async function _doSave(block: Block): Promise<void> {
    const currentBlock = blocks.value.find(b => b.id === block.id)
    if (!currentBlock) {
      pendingSaves.delete(block.id)
      return
    }
    await storage.saveBlock(block)
    pendingSaves.delete(block.id)
  }

  function _scheduleSave(block: Block): void {
    pendingSaves.get(block.id)?.cancel()
    const d = debounce(_doSave, SAVE_DEBOUNCE_MS)
    pendingSaves.set(block.id, d)
    d(block)
  }

  /** 检查循环引用 */
  function isDescendantOf(targetId: string | null, blockId: string): boolean {
    if (!targetId) return false
    if (targetId === blockId) return true
    const visited = new Set<string>()
    let current: string | null = targetId
    while (current && !visited.has(current)) {
      visited.add(current)
      if (current === blockId) return true
      const ancestor = blocks.value.find(b => b.id === current)
      current = ancestor?.parentId ?? null
    }
    return false
  }

  /**
   * 创建新 Block
   *
   * @param opts.pos - 可选。若传入则直接使用；否则自动计算（追加到末尾）
   */
  async function createBlock(
    opts: Partial<Block> & { pageId: string; content: string }
  ): Promise<Block> {
    const parentId = opts.parentId ?? null

    // 若调用方已提供 pos 则直接使用；否则计算末尾位置（带自动恢复）
    let newPos: number
    if (opts.pos !== undefined) {
      newPos = opts.pos
    } else {
      const siblings = getSortedChildren(blocks.value, parentId, opts.pageId)
      const lastPos = siblings.length > 0 ? siblings[siblings.length - 1].pos : null
      newPos = await safeCalcInsertPos(lastPos, null, blocks.value, storage)
    }

    const block: Block = {
      id: generateUUID(),
      content: opts.content,
      parentId,
      pageId: opts.pageId,
      pos: newPos,
      format: opts.format ?? {},
      type: opts.type ?? 'bullet',
      properties: opts.properties ?? {},
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    blocks.value.push(block)
    await storage.saveBlock(block)
    invalidateTagCache()
    return block
  }

  /**
   * 在光标位置插入新节点
   *
   * 插入逻辑基于光标位置：
   * - 行首：当前节点上方插入兄弟节点
   * - 行尾：子节点展开时插入为第一个子节点；否则插入为下方兄弟节点
   * - 文本中间：拆分当前节点为前后两部分，前部留原节点，后部创建新节点
   *
   * @param blockId - 目标 Block ID
   * @param cursorPos - ProseMirror 坐标系的绝对位置（1-based）
   * @param isCollapsed - 当前 Block 是否处于折叠状态
   * @param blockFormat - 可选：复制给新节点的格式（用于保持样式一致）
   * @returns 新创建的 Block（或 null）
   */
  async function insertBlockAtCursor(
    blockId: string,
    cursorPos: number,
    isCollapsed: boolean,
    blockFormat?: Record<string, any>
  ): Promise<Block | null> {
    const block = blocks.value.find(b => b.id === blockId)
    if (!block) return null

    const textOffset = pmPosToTextOffset(cursorPos)
    const contentLen = block.content.length

    // ── 位置判断 ─────────────────────────────────────────────────────────
    // 空行（contentLen === 0）应视作行尾，插入子节点而非兄弟节点
    const isEmptyLine = contentLen === 0
    const isAtLineStart = !isEmptyLine && textOffset === 0
    const isAtLineEnd = textOffset >= contentLen  // 包含空行情况
    const isInMiddle = !isAtLineStart && !isAtLineEnd

    // ── 边界处理 ──────────────────────────────────────────────────────────
    // 单字符（contentLen === 1）：cursorPos 只能在 1（行首）或 2（行尾）
    // 这两种情况都被上面的条件正确覆盖，无需额外处理

    // ── 情况1：行首位置 ─────────────────────────────────────────────────
    if (isAtLineStart) {
      // 在当前节点紧邻上方插入新的兄弟节点
      return insertSiblingAbove(block, blockFormat)
    }

    // ── 情况2/3：行尾或文本中间 ────────────────────────────────────────
    // 获取子节点用于判断插入位置
    const childBlocks = getChildren(block.id)
    const hasExpandedChildren = !isCollapsed && childBlocks.length > 0

    // 确定新节点的 parentId
    // - 有展开的子节点 → 作为第一个子节点（parentId = block.id）
    // - 其他情况 → 作为下方兄弟节点（parentId = block.parentId）
    const newParentId = hasExpandedChildren ? block.id : block.parentId

    if (isInMiddle) {
      // ── 文本中间：拆分内容 ───────────────────────────────────────────
      const before = block.content.slice(0, textOffset)
      const after = block.content.slice(textOffset)

      // 更新当前节点的内容（前半部分）
      block.content = before
      block.updatedAt = Date.now()
      _scheduleSave(block)

      // 在指定位置插入新节点（后半部分）
      return insertAtPosition(block.pageId, newParentId, after, block, childBlocks, hasExpandedChildren, blockFormat)
    } else {
      // ── 行尾：无文本拆分 ─────────────────────────────────────────────
      return insertAtPosition(block.pageId, newParentId, '', block, childBlocks, hasExpandedChildren, blockFormat)
    }
  }

  /**
   * 在当前节点紧邻的上方插入新的兄弟节点
   * 新节点与当前节点保持相同的层级关系（parentId 相同）
   */
  async function insertSiblingAbove(
    block: Block,
    blockFormat?: Record<string, any>
  ): Promise<Block> {
    const siblings = getSortedSiblings(blocks.value, block, false)
    const blockIndex = findBlockIndex(siblings, block.id)
    const prevSibling = blockIndex > 0 ? siblings[blockIndex - 1] : undefined

    // 计算新节点位置：在上一个兄弟节点之后，第一个兄弟之前
    // 若无上一个兄弟，则插入到当前父节点的最前面（prevPos = null，nextPos = 第一个兄弟的 pos）
    const prevPos = prevSibling?.pos ?? null
    const nextPos = block.pos
    const newPos = await safeCalcInsertPos(prevPos, nextPos, blocks.value, storage)

    return createBlock({
      pageId: block.pageId,
      content: '',
      parentId: block.parentId,
      pos: newPos,
      format: blockFormat ?? {}
    })
  }

  /**
   * 在指定位置插入新节点（内部辅助）
   *
   * @param pageId - 页面 ID
   * @param parentId - 父节点 ID（null 表示根级）
   * @param content - 新节点内容
   * @param refBlock - 参考 Block（用于计算位置）
   * @param childBlocks - refBlock 的现有子节点（用于子节点插入定位）
   * @param asFirstChild - 是否作为第一个子节点插入
   * @param blockFormat - 可选：格式
   */
  async function insertAtPosition(
    pageId: string,
    parentId: string | null,
    content: string,
    refBlock: Block,
    childBlocks: Block[],
    asFirstChild: boolean,
    blockFormat?: Record<string, any>
  ): Promise<Block> {
    let newPos: number

    if (asFirstChild) {
      // 作为第一个子节点：插入到现有子节点之前
      const firstChildPos = childBlocks.length > 0 ? childBlocks[0].pos : null
      newPos = await safeCalcInsertPos(null, firstChildPos, blocks.value, storage)
    } else {
      // 作为下方兄弟节点：插入到 refBlock 之后
      const nextSibling = getNextSibling(blocks.value, refBlock)
      newPos = await safeCalcInsertPos(refBlock.pos, nextSibling?.pos ?? null, blocks.value, storage)
    }

    return createBlock({
      pageId,
      content,
      parentId,
      pos: newPos,
      format: blockFormat ?? {}
    })
  }

  /** 找到文档序前驱（树前序遍历） */
  function findPreviousBlockInTreeOrder(blockId: string): Block | undefined {
    const block = blocks.value.find(b => b.id === blockId)
    if (!block) return undefined

    const siblings = getSortedSiblings(blocks.value, block, false)
    const blockIndex = siblings.findIndex(b => b.id === blockId)
    const prevSibling = blockIndex > 0 ? siblings[blockIndex - 1] : undefined

    if (prevSibling) {
      // 找最深末端子节点
      let current: Block = prevSibling
      while (true) {
        const children = getSortedChildren(blocks.value, current.id, block.pageId)
        if (children.length === 0) break
        current = children[children.length - 1]
      }
      return current
    }

    return block.parentId
      ? blocks.value.find(b => b.id === block.parentId)
      : undefined
  }

  /** 找到文档序后继（树前序遍历） */
  function findNextBlockInTreeOrder(blockId: string): Block | undefined {
    const block = blocks.value.find(b => b.id === blockId)
    if (!block) return undefined

    const children = getSortedChildren(blocks.value, block.id, block.pageId)
    if (children.length > 0) {
      return children[0]
    }

    const nextSibling = getNextSibling(blocks.value, block)
    if (nextSibling) {
      return nextSibling
    }

    let currentParentId = block.parentId
    while (currentParentId) {
      const parent = blocks.value.find(b => b.id === currentParentId)
      if (!parent) break

      const nextParentSibling = getNextSibling(blocks.value, parent)
      if (nextParentSibling) {
        return nextParentSibling
      }

      currentParentId = parent.parentId
    }

    return undefined
  }

  /** 与上一个 Block 合并 */
  async function mergeWithPrevious(blockId: string) {
    const block = blocks.value.find(b => b.id === blockId)
    if (!block) return

    const prev = findPreviousBlockInTreeOrder(blockId)
    if (!prev) return

    const prevContentLen = prev.content.length
    prev.content += block.content
    const cursorPos = prevContentLen + 1
    prev.updatedAt = Date.now()
    await storage.saveBlock(prev)

    await deleteBlock(blockId)
    return { id: prev.id, cursorPos }
  }

  /** 缩进 */
  async function indent(blockId: string) {
    const block = blocks.value.find(b => b.id === blockId)
    if (!block) return

    const prev = getPrevSibling(blocks.value, block)
    if (!prev) return

    // 先计算新位置（在修改 parentId 之前）
    const children = getChildren(prev.id)
    const lastPos = children.length > 0 ? children[children.length - 1].pos : null
    const newPos = await safeCalcInsertPos(lastPos, null, blocks.value, storage)

    // 再修改 parentId 和 pos
    block.parentId = prev.id
    block.pos = newPos

    block.updatedAt = Date.now()
    _scheduleSave(block)
  }

  /** 反缩进 */
  async function outdent(blockId: string) {
    const block = blocks.value.find(b => b.id === blockId)
    if (!block || !block.parentId) return

    const parent = blocks.value.find(b => b.id === block.parentId)
    if (!parent) return

    const newParentId = parent.parentId

    // 先计算新位置（在修改 parentId 之前）
    const nextSibling = getNextSibling(blocks.value, parent)
    const newPos = await safeCalcInsertPos(parent.pos, nextSibling?.pos ?? null, blocks.value, storage)

    // 再修改 parentId 和 pos
    block.parentId = newParentId
    block.pos = newPos

    block.updatedAt = Date.now()
    _scheduleSave(block)
  }

  /** 移动 Block */
  async function moveBlock(opts: {
    blockId: string
    toParentId: string | null
    newIndex: number
  }) {
    const { blockId, toParentId, newIndex } = opts
    const block = blocks.value.find(b => b.id === blockId)
    if (!block) return

    if (isDescendantOf(toParentId, blockId)) {
      console.warn('[moveBlock] 禁止循环移动')
      return
    }

    const targetSiblings = getSortedChildren(blocks.value, toParentId, block.pageId, blockId)
    const clampedIndex = Math.max(0, Math.min(newIndex, targetSiblings.length))

    const prevPos = clampedIndex > 0 ? targetSiblings[clampedIndex - 1].pos : null
    const nextPos = clampedIndex < targetSiblings.length ? targetSiblings[clampedIndex].pos : null

    block.parentId = toParentId
    block.pos = await safeCalcInsertPos(prevPos, nextPos, blocks.value, storage)
    block.updatedAt = Date.now()

    _scheduleSave(block)
  }

  /** 删除 Block */
  async function deleteBlock(blockId: string) {
    const toDelete = new Set<string>([blockId])
    const queue = [blockId]

    while (queue.length > 0) {
      const currentId = queue.pop()!
      const children = blocks.value.filter(b => b.parentId === currentId)
      for (const child of children) {
        if (!toDelete.has(child.id)) {
          toDelete.add(child.id)
          queue.push(child.id)
        }
      }
    }

    for (const id of toDelete) {
      pendingSaves.get(id)?.cancel()
      pendingSaves.delete(id)
    }

    blocks.value = blocks.value.filter(b => !toDelete.has(b.id))

    try {
      await storage.deleteBlockCascade(Array.from(toDelete))
    } catch (error) {
      console.error('[deleteBlock] Failed to delete blocks from IDB:', error)
    }

    invalidateTagCache()
  }

  /** 更新 Block 内容 */
  async function updateBlockContent(blockId: string, content: string) {
    const block = blocks.value.find(b => b.id === blockId)
    if (!block) return

    block.content = content
    block.updatedAt = Date.now()
    _scheduleSave(block)
    invalidateTagCache()

    const pageStore = usePageStore()
    const page = pageStore.getPage(block.pageId)
    if (page) {
      page.updatedAt = Date.now()
      await storage.updatePage(page)
    }
  }

  /** 更新 Block 格式 */
  async function updateBlockFormat(blockId: string, format: Record<string, any>) {
    const block = blocks.value.find(b => b.id === blockId)
    if (!block) return

    block.format = { ...block.format, ...format }
    block.updatedAt = Date.now()
    _scheduleSave(block)
  }

  /** 更新 Block 属性 */
  async function updateBlockProperties(blockId: string, properties: Record<string, any>) {
    const block = blocks.value.find(b => b.id === blockId)
    if (!block) return

    block.properties = { ...block.properties, ...properties }
    block.updatedAt = Date.now()
    _scheduleSave(block)
  }

  return {
    blocks,
    sortedBlocks,
    blockTree,
    loading,
    getChildren,
    loadPageBlocks,
    loadMultiPageBlocks,
    createBlock,
    insertBlockAtCursor,
    insertSiblingAbove,
    insertAtPosition,
    mergeWithPrevious,
    findPreviousBlockInTreeOrder,
    findNextBlockInTreeOrder,
    indent,
    outdent,
    moveBlock,
    deleteBlock,
    updateBlockContent,
    updateBlockFormat,
    updateBlockProperties,
    isDescendantOf
  }
})
