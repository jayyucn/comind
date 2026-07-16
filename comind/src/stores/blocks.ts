import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Block } from '../types/block'
import { initCoreClient, triggerSync } from '../wasm/client'
import { generateUUID } from '../utils/id'
import { debounce } from '../utils/debounce'
import { parseBlockLinks } from '../utils/parser'
import { usePageStore } from './pages'
import { useBlockVersionStore } from './blockVersion'
import { usePropertyStore } from './property'
import type { BlockSnapshot } from '../types/blockVersion'

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
  findBlockIndex,
  isDescendantOf
} from '../utils/block-helpers'

import type { CoreClient } from '../wasm/client'
import type { BatchOperation } from '@/wasm/types'

let coreClientPromise: Promise<CoreClient> | null = null

async function getClient() {
  if (!coreClientPromise) {
    coreClientPromise = initCoreClient()
  }
  const client = await coreClientPromise
  if (!client) {
    throw new Error('Core client not initialized')
  }
  return client
}

/**
 * 安全计算插入位置，带自动重试机制
 *
 * 当间隔耗尽时自动触发重新编号，然后通过回调重新计算位置参数。
 * 这解决了重编号后 prevPos/nextPos 过时的问题。
 *
 * @param prevPos 前一个节点的 pos
 * @param nextPos 后一个节点的 pos
 * @param blocksRef Block 列表引用（用于重新编号）
 * @param recalcPos 可选：重编号后重新计算位置的回调函数
 * @returns 新节点的 pos 值
 */
async function safeCalcInsertPos(
  prevPos: number | null,
  nextPos: number | null,
  blocksRef: Block[],
  recalcPos?: () => { prevPos: number | null; nextPos: number | null }
): Promise<number> {
  try {
    return calcInsertPos(prevPos, nextPos)
  } catch (error) {
    if (isGapExhaustedError(error)) {
      console.warn('[safeCalcInsertPos] Gap exhausted, triggering renumbering...')

      renumberBlocks(blocksRef)

      const client = await getClient()
      for (const block of blocksRef) {
        await client.saveBlockTree([{
          id: block.id,
          page_id: block.pageId,
          parent_id: block.parentId,
          pos: block.pos,
          content: block.content,
          format: JSON.stringify(block.format || {}),
          type: block.type,
          created_at: block.createdAt,
          updated_at: Date.now()
        }])
      }

      console.info('[safeCalcInsertPos] Renumbering complete, recalculating positions...')

      if (recalcPos) {
        const { prevPos: newPrevPos, nextPos: newNextPos } = recalcPos()
        console.info(`[safeCalcInsertPos] Recalculated: prev=${newPrevPos}, next=${newNextPos}`)

        try {
          return calcInsertPos(newPrevPos, newNextPos)
        } catch (retryError) {
          console.error('[safeCalcInsertPos] Retry failed after renumbering:', retryError)
          throw new Error(
            'Failed to calculate insert position even after renumbering. ' +
            'This indicates a serious data consistency issue.'
          )
        }
      }

      console.warn('[safeCalcInsertPos] No recalcPos callback provided, retrying with original positions')
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

  /** 待处理的已删除页面警告列表 */
  const trashedPageWarnings = ref<string[]>([])

  /** 清除已删除页面警告 */
  function clearTrashedPageWarnings() {
    trashedPageWarnings.value = []
  }

  /** 结构版本号 - 用于触发 Sortable 实例重建 */
  const structureVersion = ref(0)

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

  /** 获取指定页面的所有 Block */
  function getBlocksByPage(pageId: string): Block[] {
    return blocks.value.filter(b => b.pageId === pageId)
  }

  /** 根据 ID 获取单个 Block */
  function getBlock(blockId: string): Block | undefined {
    return blocks.value.find(b => b.id === blockId)
  }

  /** 获取指定页面的出链 */
  async function getOutlinks(pageId: string): Promise<{ id: string; sourceBlockId: string; targetPageId: string; relationshipType: string | null; createdAt: number }[]> {
    const client = await getClient()
    const links = await client.getOutlinks(pageId)
    return links.map(link => ({
      id: link.id,
      sourceBlockId: link.source_block_id,
      targetPageId: link.target_page_id,
      relationshipType: link.relationship_type,
      createdAt: link.created_at
    }))
  }

  /** 获取指定页面的入链（反向链接） */
  async function getBacklinks(pageId: string): Promise<{ id: string; sourceBlockId: string; targetPageId: string; relationshipType: string | null; createdAt: number }[]> {
    const client = await getClient()
    const links = await client.getBacklinks(pageId)
    return links.map(link => ({
      id: link.id,
      sourceBlockId: link.source_block_id,
      targetPageId: link.target_page_id,
      relationshipType: link.relationship_type,
      createdAt: link.created_at
    }))
  }

  /** 加载指定 Page 的 Block 树 */
  async function loadPageBlocks(pageId: string) {
    const client = await getClient()
    const rustBlocks = await client.getBlocksByPage(pageId)
    
    blocks.value = rustBlocks.map(rustBlock => ({
      id: rustBlock.id,
      pageId: rustBlock.page_id,
      parentId: rustBlock.parent_id,
      pos: rustBlock.pos,
      content: rustBlock.content,
      format: JSON.parse(rustBlock.format || '{}'),
      type: rustBlock.type as Block['type'],
      properties: {},
      createdAt: rustBlock.created_at,
      updatedAt: rustBlock.updated_at
    }))
    structureVersion.value++
    return blocks
  }

  /** 批量加载多个 Page 的 Block 树 */
  async function loadMultiPageBlocks(pageIds: string[]) {
    loading.value = true
    const client = await getClient()
    try {
      const results = await Promise.allSettled(
        pageIds.map(async id => {
          const rustBlocks = await client.getBlocksByPage(id)
          return rustBlocks.map(rustBlock => ({
            id: rustBlock.id,
            pageId: rustBlock.page_id,
            parentId: rustBlock.parent_id,
            pos: rustBlock.pos,
            content: rustBlock.content,
            format: JSON.parse(rustBlock.format || '{}'),
            type: rustBlock.type as Block['type'],
            properties: {},
            createdAt: rustBlock.created_at,
            updatedAt: rustBlock.updated_at
          }))
        })
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
      structureVersion.value++
    } catch (error) {
      console.error('[loadMultiPageBlocks] Unexpected error:', error)
    } finally {
      loading.value = false
    }
  }

  /** 按 ID 加载单个 Block 并合并进缓存（若已存在则直接返回缓存） */
  async function loadBlock(blockId: string): Promise<Block | undefined> {
    const existing = blocks.value.find(b => b.id === blockId)
    if (existing) return existing

    const client = await getClient()
    try {
      const rustBlock = await client.getBlock(blockId)
      const block: Block = {
        id: rustBlock.id,
        pageId: rustBlock.page_id,
        parentId: rustBlock.parent_id,
        pos: rustBlock.pos,
        content: rustBlock.content,
        format: JSON.parse(rustBlock.format || '{}'),
        type: rustBlock.type as Block['type'],
        createdAt: rustBlock.created_at,
        updatedAt: rustBlock.updated_at
      }
      blocks.value.push(block)
      return block
    } catch (err) {
      console.error('[loadBlock] Failed to load block:', err)
      return undefined
    }
  }

  /** 每个 Block 独立的防抖保存 */
  const pendingSaves = new Map<string, ReturnType<typeof debounce<typeof _doSave>>>()

  let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null

  function _triggerSyncDebounced() {
    if (syncDebounceTimer) clearTimeout(syncDebounceTimer)
    syncDebounceTimer = setTimeout(() => {
      triggerSync().catch(console.error)
    }, 5000)
  }

  async function _doSave(block: Block): Promise<void> {
    const currentBlock = blocks.value.find(b => b.id === block.id)
    if (!currentBlock) {
      pendingSaves.delete(block.id)
      return
    }

    const client = await getClient()
    const blockUpdate = {
      id: currentBlock.id,
      page_id: currentBlock.pageId,
      parent_id: currentBlock.parentId,
      pos: currentBlock.pos,
      content: currentBlock.content,
      format: JSON.stringify(currentBlock.format || {}),
      type: currentBlock.type,
      created_at: currentBlock.createdAt,
      updated_at: Date.now()
    }

    try {
      await client.saveBlockTree([blockUpdate])
      await _syncBlockLinks(currentBlock, client)
      _triggerSyncDebounced()
      await _createBlockVersion(currentBlock, client)
    } catch (error) {
      console.error('[BlockStore] Failed to save block:', error)
      throw error
    } finally {
      pendingSaves.delete(block.id)
    }
  }

  async function _createBlockVersion(block: Block, client: CoreClient): Promise<void> {
    try {
      const properties = await client.getProperties(block.id)
      const outlinks = await client.getOutlinks(block.pageId)

      const blockLinks = outlinks.filter(link => link.source_block_id === block.id)

      // Rust 端 Block.format 是 String 类型，需要序列化为 JSON 字符串以匹配 Rust 结构
      const blockRecord = {
        id: block.id,
        page_id: block.pageId,
        parent_id: block.parentId,
        pos: block.pos,
        content: block.content,
        format: JSON.stringify(block.format || {}),
        type: block.type,
        created_at: block.createdAt,
        updated_at: block.updatedAt
      }

      const snapshot: BlockSnapshot = {
        block: blockRecord as unknown as BlockSnapshot['block'],
        properties: properties as unknown as BlockSnapshot['properties'],
        relationships: blockLinks as unknown as BlockSnapshot['relationships']
      }

      const versionStore = useBlockVersionStore()
      versionStore.scheduleVersion(block.id, snapshot, 'auto')
    } catch (error) {
      console.error('[BlockStore] Failed to create block version:', error)
    }
  }

  async function _syncBlockLinks(block: Block, client: CoreClient): Promise<void> {
    const parsedLinks = parseBlockLinks(block.content)
    const pageStore = usePageStore()
    const internalLinks = parsedLinks.filter(l => !l.isExternal)

    // "引用即创建"：目标页面不存在时自动创建
    const links = await Promise.all(
      internalLinks.map(async l => {
        const targetPage = await pageStore.getOrCreatePageByTitle(l.targetTitle)
        return {
          source_block_id: block.id,
          target_page_id: targetPage.id,
          display_text: l.displayText,
          relationship_type: l.relationshipType
        }
      })
    )

    await client.executeBatch([{
      entity: 'link',
      action: 'sync_by_block',
      params: {
        block_id: block.id,
        links
      }
    }])
  }

  function _scheduleSave(block: Block): void {
    pendingSaves.get(block.id)?.cancel()
    const d = debounce(_doSave, SAVE_DEBOUNCE_MS)
    pendingSaves.set(block.id, d)
    d(block)
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
      const calcPositions = () => {
        const siblings = getSortedChildren(blocks.value, parentId, opts.pageId)
        const lastPos = siblings.length > 0 ? siblings[siblings.length - 1].pos : null
        return { prevPos: lastPos, nextPos: null }
      }
      const { prevPos, nextPos } = calcPositions()
      newPos = await safeCalcInsertPos(prevPos, nextPos, blocks.value, calcPositions)
    }

    const block: Block = {
      id: generateUUID(),
      content: opts.content,
      parentId,
      pageId: opts.pageId,
      pos: newPos,
      format: opts.format ?? {},
      type: opts.type ?? 'bullet',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    blocks.value.push(block)
    structureVersion.value++
    _scheduleSave(block)

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

    // ── 获取原 block 的 status（新 block 也加 todo）────────────────────────
    const propertyStore = usePropertyStore()
    const hasSourceStatus = !!propertyStore.getBlockProperty(blockId, 'status')

    // ── 位置判断 ─────────────────────────────────────────────────────────
    // 空行（contentLen === 0）应视作行尾，插入子节点而非兄弟节点
    const isEmptyLine = contentLen === 0
    const isAtLineStart = !isEmptyLine && textOffset === 0
    const isAtLineEnd = textOffset >= contentLen  // 包含空行情况
    const isInMiddle = !isAtLineStart && !isAtLineEnd

    // ── 边界处理 ──────────────────────────────────────────────────────────
    // 单字符（contentLen === 1）：cursorPos 只能在 1（行首）或 2（行尾）
    // 这两种情况都被上面的条件正确覆盖，无需额外处理

    let newBlock: Block | null = null

    // ── 情况1：行首位置 ─────────────────────────────────────────────────
    if (isAtLineStart) {
      // 在当前节点紧邻上方插入新的兄弟节点
      newBlock = await insertSiblingAbove(block, blockFormat)
    } else {
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
        newBlock = await insertAtPosition(block.pageId, newParentId, after, block, childBlocks, hasExpandedChildren, blockFormat)
      } else {
        // ── 行尾：无文本拆分 ─────────────────────────────────────────────
        newBlock = await insertAtPosition(block.pageId, newParentId, '', block, childBlocks, hasExpandedChildren, blockFormat)
      }
    }

    // ── 原 block 有 status 时，新 block 加 Todo ───────────────────────────
    // 注意：需先 _doSave 将新 block 持久化到数据库，否则 setProperty 会因
    // FOREIGN KEY 约束失败（property 表引用不存在的 block）
    if (newBlock && hasSourceStatus) {
      await _doSave(newBlock)
      await propertyStore.setProperty(newBlock.id, 'status', 'Todo', 'string')
    }

    return newBlock
  }

  /**
   * 在当前节点紧邻的上方插入新的兄弟节点
   * 新节点与当前节点保持相同的层级关系（parentId 相同）
   */
  async function insertSiblingAbove(
    block: Block,
    blockFormat?: Record<string, any>
  ): Promise<Block> {
    // 预先捕获 nextPos，避免 renumber 后 block.pos 被就地修改导致回调中的 nextPos 偏离
    const originalNextPos = block.pos

    const calcPositions = () => {
      const siblings = getSortedSiblings(blocks.value, block, false)
      const blockIndex = findBlockIndex(siblings, block.id)
      const prevSibling = blockIndex > 0 ? siblings[blockIndex - 1] : undefined
      return {
        prevPos: prevSibling?.pos ?? null,
        // 必须用原始 nextPos，不能用 block.pos（renumber 后 block.pos 已改变）
        nextPos: originalNextPos
      }
    }

    const { prevPos, nextPos } = calcPositions()
    const newPos = await safeCalcInsertPos(
      prevPos,
      nextPos,
      blocks.value,
      calcPositions
    )

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
   * @param childBlocks - refBlock 的现有子节点（已废弃，保留参数签名兼容）
   * @param asFirstChild - 是否作为第一个子节点插入
   * @param blockFormat - 可选：格式
   */
  async function insertAtPosition(
    pageId: string,
    parentId: string | null,
    content: string,
    refBlock: Block,
    _childBlocks: Block[],
    asFirstChild: boolean,
    blockFormat?: Record<string, any>
  ): Promise<Block> {
    let newPos: number

    // 预先捕获 refBlock.pos，避免 renumber 后 refBlock.pos 被就地修改
    const originalPrevPos = refBlock.pos

    if (asFirstChild) {
      // 作为第一个子节点：插入到现有子节点之前
      const calcPositions = () => {
        // 重编号后重新获取子节点列表
        const updatedChildren = getSortedChildren(blocks.value, refBlock.id, pageId)
        return {
          prevPos: null,
          nextPos: updatedChildren.length > 0 ? updatedChildren[0].pos : null
        }
      }

      const { prevPos, nextPos } = calcPositions()
      newPos = await safeCalcInsertPos(
        prevPos,
        nextPos,
        blocks.value,
        calcPositions
      )
    } else {
      // 作为下方兄弟节点：插入到 refBlock 之后
      const calcPositions = () => {
        // 重编号后重新获取兄弟节点
        const nextSibling = getNextSibling(blocks.value, refBlock)
        return {
          // 必须用原始 prevPos，不能用 refBlock.pos（renumber 后已改变）
          prevPos: originalPrevPos,
          nextPos: nextSibling?.pos ?? null
        }
      }

      const { prevPos, nextPos } = calcPositions()
      newPos = await safeCalcInsertPos(
        prevPos,
        nextPos,
        blocks.value,
        calcPositions
      )
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

  /**
   * 找到上一个 Block 的最后一个可见后代
   *
   * "可见" 定义：该 Block 本身没有展开的子 Block，即：
   * - 没有子 Block，或
   * - 已折叠（format.collapsed === true）
   *
   * 如果上一个 Block 本身满足以上条件，则返回上一个 Block 本身。
   */
  function findLastVisibleDescendant(blockId: string): Block | undefined {
    const block = blocks.value.find(b => b.id === blockId)
    if (!block) return undefined

    // 检查是否有展开的子 Block
    const children = getSortedChildren(blocks.value, block.id, block.pageId)
    const isCollapsed = block.format?.collapsed === true

    // 没有子 Block 或已折叠 → 自己就是最后一个可见节点
    if (children.length === 0 || isCollapsed) {
      return block
    }

    // 有展开的子 Block → 递归进入最后一个子 Block
    const lastChild = children[children.length - 1]
    return findLastVisibleDescendant(lastChild.id)
  }

  /**
   * 找到当前 Block 在视觉上的前一个 Block（考虑折叠状态）
   *
   * 与 findPreviousBlockInTreeOrder 不同，此函数考虑折叠状态：
   * - 如果前一个兄弟 Block 有展开的子 Block，会深入到最后一个可见后代
   * - 如果前一个兄弟 Block 已折叠或没有子 Block，返回前一个兄弟本身
   * - 如果没有前一个兄弟，返回父 Block
   */
  function findPreviousVisibleBlock(blockId: string): Block | undefined {
    const block = blocks.value.find(b => b.id === blockId)
    if (!block) return undefined

    const siblings = getSortedSiblings(blocks.value, block, false)
    const blockIndex = siblings.findIndex(b => b.id === blockId)
    const prevSibling = blockIndex > 0 ? siblings[blockIndex - 1] : undefined

    if (prevSibling) {
      // 从前一个兄弟开始，找到最后一个可见后代
      return findLastVisibleDescendant(prevSibling.id)
    }

    // 没有前一个兄弟 → 返回父 Block
    return block.parentId
      ? blocks.value.find(b => b.id === block.parentId)
      : undefined
  }

  /**
   * 与上一个可见 Block 合并（Backspace 键操作）
   *
   * 合并规则：
   * 1. 找到当前 Block 在视觉上的前一个 Block（考虑折叠状态）
   *    a. 前驱没有子 Block / 已折叠 → 前驱本身就是合并目标
   *    b. 前驱有展开的子 Block → 最后一个可见后代是合并目标
   * 2. 合并后保留所有文本内容、格式信息和元数据
   * 3. 光标定位到合并后内容的拼接位置（目标 Block 原有内容的末尾）
   * 4. 被合并节点的子节点保留并转移到目标节点
   */
  async function mergeWithPrevious(blockId: string) {
    const block = blocks.value.find(b => b.id === blockId)
    if (!block) return

    const mergeTarget = findPreviousVisibleBlock(blockId)
    if (!mergeTarget) return

    const targetContentLen = mergeTarget.content.length
    mergeTarget.content += block.content

    const cursorPos = targetContentLen + 1
    mergeTarget.updatedAt = Date.now()
    _scheduleSave(mergeTarget)

    const childrenToMove: Block[] = []
    for (const child of blocks.value) {
      if (child.parentId === block.id) {
        childrenToMove.push(child)
      }
    }

    if (childrenToMove.length > 0) {
      const mergeTargetChildren = blocks.value.filter(b => b.parentId === mergeTarget.id)
      const lastMergeChild = mergeTargetChildren[mergeTargetChildren.length - 1]

      // 使用 safeCalcInsertPos，避免 Gap 耗尽时直接抛错
      let prevPos = lastMergeChild?.pos ?? null
      for (const child of childrenToMove) {
        const calcPositions = () => ({ prevPos, nextPos: null })
        const newPos = await safeCalcInsertPos(prevPos, null, blocks.value, calcPositions)
        child.parentId = mergeTarget.id
        child.pos = newPos
        child.updatedAt = Date.now()
        _scheduleSave(child)
        prevPos = newPos
      }

      structureVersion.value++
    }

    await deleteBlock(blockId)

    return { id: mergeTarget.id, cursorPos }
  }

  /** 缩进 */
  async function indent(blockId: string) {
    const block = blocks.value.find(b => b.id === blockId)
    if (!block) return

    const prev = getPrevSibling(blocks.value, block)
    if (!prev) return

    // 先计算新位置（在修改 parentId 之前）
    const calcPositions = () => {
      const children = getChildren(prev.id)
      const lastPos = children.length > 0 ? children[children.length - 1].pos : null
      return { prevPos: lastPos, nextPos: null }
    }
    const { prevPos, nextPos } = calcPositions()
    const newPos = await safeCalcInsertPos(prevPos, nextPos, blocks.value, calcPositions)

    // 再修改 parentId 和 pos
    block.parentId = prev.id
    block.pos = newPos

    block.updatedAt = Date.now()
    _scheduleSave(block)

    structureVersion.value++
  }

  /** 反缩进 */
  async function outdent(blockId: string) {
    const block = blocks.value.find(b => b.id === blockId)
    if (!block || !block.parentId) return

    const parent = blocks.value.find(b => b.id === block.parentId)
    if (!parent) return

    const newParentId = parent.parentId

    // 先计算新位置（在修改 parentId 之前）
    const calcPositions = () => {
      const nextSibling = getNextSibling(blocks.value, parent)
      return { prevPos: parent.pos, nextPos: nextSibling?.pos ?? null }
    }
    const { prevPos, nextPos } = calcPositions()
    const newPos = await safeCalcInsertPos(prevPos, nextPos, blocks.value, calcPositions)

    // 再修改 parentId 和 pos
    block.parentId = newParentId
    block.pos = newPos

    block.updatedAt = Date.now()
    _scheduleSave(block)

    structureVersion.value++
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

    if (isDescendantOf(blocks.value, toParentId, blockId)) {
      console.warn('[moveBlock] 禁止循环移动')
      return
    }

    const calcPositions = () => {
      const targetSiblings = getSortedChildren(blocks.value, toParentId, block.pageId, blockId)
      const clampedIndex = Math.max(0, Math.min(newIndex, targetSiblings.length))
      return {
        prevPos: clampedIndex > 0 ? targetSiblings[clampedIndex - 1].pos : null,
        nextPos: clampedIndex < targetSiblings.length ? targetSiblings[clampedIndex].pos : null
      }
    }

    const { prevPos, nextPos } = calcPositions()
    block.parentId = toParentId
    block.pos = await safeCalcInsertPos(prevPos, nextPos, blocks.value, calcPositions)
    block.updatedAt = Date.now()

    _scheduleSave(block)

    structureVersion.value++
  }

  /**
   * 批量删除 Block（支持级联子节点）
   * - 一次性收集所有根节点 + 子孙节点
   * - 一次性过滤 reactive 数组（无延迟）
   * - 一次 execute_batch 调用（无串行 IPC 往返）
   */
  async function deleteBlocks(rootIds: string[]) {
    if (rootIds.length === 0) return

    // 1. 收集所有要删除的块（含子孙）
    const toDelete = new Set<string>()
    for (const rootId of rootIds) {
      if (toDelete.has(rootId)) continue
      const queue = [rootId]
      while (queue.length > 0) {
        const currentId = queue.pop()!
        toDelete.add(currentId)
        for (const child of blocks.value) {
          if (child.parentId === currentId && !toDelete.has(child.id)) {
            queue.push(child.id)
          }
        }
      }
    }

    // 2. 立即从 reactive 数组移除（同步，触发 tree rebuild）
    for (const id of toDelete) {
      pendingSaves.get(id)?.cancel()
      pendingSaves.delete(id)
    }
    blocks.value = blocks.value.filter(b => !toDelete.has(b.id))

    // 3. 触发 tree rebuild
    structureVersion.value++

    // 4. RPC fire-and-forget（paint 之后才发出）
    const operations: BatchOperation[] = [...toDelete].map(id => ({
      entity: 'block',
      action: 'delete',
      params: { id }
    }))
    setTimeout(async () => {
      try {
        const client = await getClient()
        await client.executeBatch(operations)
      } catch (error) {
        console.error('[deleteBlocks] execute_batch failed:', error)
      }
    }, 0)
  }

  /** 删除单个 Block（委托给批量删除） */
  async function deleteBlock(blockId: string) {
    await deleteBlocks([blockId])
  }

  /** 更新 Block 内容 */
  async function updateBlockContent(blockId: string, content: string) {
    const block = blocks.value.find(b => b.id === blockId)
    if (!block) return

    block.content = content
    block.updatedAt = Date.now()
    _scheduleSave(block)

    // 自动将带 schedule/deadline 的 block 标记为 Todo 任务。
    // 这是所有写入 content 路径的统一收口（/schedule、/deadline 命令、
    // 输入 {{、粘贴等最终都会流经此处），因此无论用何种方式写入 dateRef，
    // block 都会自动成为任务。仅当 block 尚无 status 时补 Todo；
    // 移除 dateRef 时不会反向清除 status（保持任务状态）。
    if (/\{\{(?:schedule|deadline):/.test(content)) {
      const propertyStore = usePropertyStore()
      await propertyStore.ensureTodo(blockId)
    }
  }

  /** 更新 Block 格式 */
  async function updateBlockFormat(blockId: string, format: Record<string, any>) {
    const block = blocks.value.find(b => b.id === blockId)
    if (!block) return

    block.format = { ...block.format, ...format }
    block.updatedAt = Date.now()
    _scheduleSave(block)
    structureVersion.value++
  }

  /** 更新 Block 类型 */
  async function updateBlockType(blockId: string, type: Block['type']) {
    const block = blocks.value.find(b => b.id === blockId)
    if (!block) return

    block.type = type
    block.updatedAt = Date.now()
    _scheduleSave(block)
  }

  /** 更新 Block 属性（使用独立的 properties 表） */
  async function updateBlockProperties(blockId: string, properties: Record<string, any>) {
    const client = await getClient()
    for (const [key, value] of Object.entries(properties)) {
      const valueStr = typeof value === 'string' ? value : JSON.stringify(value)
      await client.setProperty(blockId, key, valueStr, typeof value === 'string' ? 'string' : 'object')
    }
    structureVersion.value++
  }

  /** 调度单个 Block 的防抖持久化（供外部拖拽同步调用） */
  function scheduleSave(blockId: string) {
    const block = blocks.value.find(b => b.id === blockId)
    if (block) _scheduleSave(block)
  }

  return {
    blocks,
    sortedBlocks,
    blockTree,
    loading,
    structureVersion,
    getChildren,
    getBlocksByPage,
    getBlock,
    getOutlinks,
    getBacklinks,
    loadPageBlocks,
    loadMultiPageBlocks,
    loadBlock,
    createBlock,
    insertBlockAtCursor,
    insertSiblingAbove,
    insertAtPosition,
    mergeWithPrevious,
    findPreviousBlockInTreeOrder,
    findPreviousVisibleBlock,
    findLastVisibleDescendant,
    findNextBlockInTreeOrder,
    indent,
    outdent,
    moveBlock,
    deleteBlock,
    deleteBlocks,
    updateBlockContent,
    updateBlockFormat,
    updateBlockType,
    updateBlockProperties,
    scheduleSave,
    trashedPageWarnings,
    clearTrashedPageWarnings
  }
})
