import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Block, BlockWithPos } from '../types/block'
import { storage } from '../storage/indexedDB'
import { generateUUID } from '../utils/id'
import { debounce } from '../utils/debounce'
import { invalidateTagCache } from '../composables/useTagFilter'
import { usePageStore } from './pages'
import {
  pmPosToTextOffset,
  getSortedChildren,
  getSortedSiblings,
  sortByLeftId,
  findBlockIndex,
  getPrevSibling,
  getNextSibling,
  SAVE_DEBOUNCE_MS
} from '../utils/block-helpers'

export const useBlockStore = defineStore('blocks', () => {
  const blocks = ref<BlockWithPos[]>([])
  const loading = ref(false)

  /** 按 leftId 排序的扁平 Block 列表 */
  const sortedBlocks = computed(() => sortByLeftId([...blocks.value]))

  /** 构建 Block 树（parentId → children[]） */
  const blockTree = computed(() => {
    const map = new Map<string | null, BlockWithPos[]>()
    for (const block of blocks.value) {
      const list = map.get(block.parentId) ?? []
      list.push(block)
      map.set(block.parentId, list)
    }
    // 每组内按 leftId 排序
    for (const [key, list] of map) {
      map.set(key, sortByLeftId(list))
    }
    return map
  })

  /** 获取某 Block 的直接子节点 */
  function getChildren(parentId: string): BlockWithPos[] {
    return blockTree.value.get(parentId) ?? []
  }

  /** 加载指定 Page 的 Block 树 */
  async function loadPageBlocks(pageId: string) {
    blocks.value = await storage.getBlockTree(pageId)
    return blocks
  }

  /** 批量加载多个 Page 的 Block 树（append 模式，不清空已有数据）
   *  用于 JournalList 等需要同时展示多个 Page 内容的场景
   */
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
              blocks.value.push(block as BlockWithPos)
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

  /** 每个 Block 独立的防抖保存（Map 确保删除时能取消 pending save） */
  const pendingSaves = new Map<string, ReturnType<typeof debounce<typeof _doSave>>>()

  async function _doSave(block: Block): Promise<void> {
    // 检查 block 是否仍在内存中（可能被删了）
    const currentBlock = blocks.value.find(b => b.id === block.id)
    if (!currentBlock) {
      pendingSaves.delete(block.id)
      return
    }
    await storage.saveBlock(block)
    pendingSaves.delete(block.id)
  }

  function _scheduleSave(block: Block): void {
    // 取消该 block 之前的 pending save
    pendingSaves.get(block.id)?.cancel()
    const d = debounce(_doSave, SAVE_DEBOUNCE_MS)
    pendingSaves.set(block.id, d)
    d(block)
  }

  /**
   * 检查 targetId 是否是 blockId 的后代
   * @param targetId 要检查的节点（移动目标）
   * @param blockId 潜在祖先（被拖拽的 block）
   */
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

  /** 创建新 Block */
  async function createBlock(
    opts: Partial<BlockWithPos> & { pageId: string; content: string }
  ): Promise<BlockWithPos> {
    const parentId = opts.parentId ?? null
    const siblings = getSortedChildren(blocks.value, parentId, opts.pageId)
    const lastSibling = siblings.length > 0 ? siblings[siblings.length - 1] : undefined

    const block: BlockWithPos = {
      id: generateUUID(),
      content: opts.content,
      parentId,
      pageId: opts.pageId,
      leftId: lastSibling?.id ?? null,
      format: opts.format ?? {},
      type: opts.type ?? 'bullet',
      properties: opts.properties ?? {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pos: 0
    }

    blocks.value.push(block)
    await storage.saveBlock(block)
    invalidateTagCache()
    return block
  }

  /**
   * 在光标位置拆分 Block
   *
   * @param blockId 要拆分的 Block ID
   * @param cursorPos ProseMirror 光标位置（包含段落标签开销）
   *   - 空段落: <p>|</p> 光标位置为 1
   *   - 有文本: <p>|text</p> 光标位置为 1（文本开始前）
   *   - 示例: <p>hel|lo</p> 光标位置为 4（'l' 后）
   *
   * @param isCollapsed 当前 Block 是否处于折叠状态
   *   - false: 创建为当前 Block 的子节点
   *   - true: 创建为当前 Block 的兄弟节点
   */
  async function splitBlock(blockId: string, cursorPos: number, isCollapsed?: boolean) {
    const block = blocks.value.find(b => b.id === blockId)
    if (!block) return

    // ProseMirror 位置转换为文本偏移量
    const textOffset = pmPosToTextOffset(cursorPos)
    const before = block.content.slice(0, textOffset)
    const after = block.content.slice(textOffset)

    block.content = before
    block.updatedAt = Date.now()
    await storage.saveBlock(block)

    const childBlocks = getChildren(block.id)
    const isCreateChild = !isCollapsed && childBlocks.length > 0
    const newParentId = isCreateChild ? block.id : block.parentId

    const newBlock = await createBlock({
      pageId: block.pageId,
      content: after,
      parentId: newParentId,
      pos: 0
    })

    return newBlock
  }

  /**
   * 找到指定 Block 在文档序中的前一个 Block（树前序遍历前驱）
   * 算法：
   *   1. 找同级前兄弟（same parentId, 按 leftId 排序）
   *   2. 有前兄弟 → 取其最深末端子节点
   *   3. 无前兄弟 → 返回父节点（顶层块无前驱）
   */
  function findPreviousBlockInTreeOrder(blockId: string): BlockWithPos | undefined {
    const block = blocks.value.find(b => b.id === blockId)
    if (!block) return undefined

    const siblings = getSortedSiblings(blocks.value, block, false)
    const blockIndex = findBlockIndex(siblings, blockId)
    const prevSibling = blockIndex > 0 ? siblings[blockIndex - 1] : undefined

    if (prevSibling) {
      // 有前兄弟 → 找最深末端子节点
      let current: BlockWithPos = prevSibling
      while (true) {
        const children = getSortedChildren(blocks.value, current.id, block.pageId)
        if (children.length === 0) break
        current = children[children.length - 1]
      }
      return current
    }

    // 无前兄弟 → 返回父节点（顶层块父节点为 null，无前驱）
    return block.parentId
      ? blocks.value.find(b => b.id === block.parentId)
      : undefined
  }

  /**
   * 找到指定 Block 在文档序中的下一个 Block（树前序遍历后继）
   * 算法：
   *   1. 有子节点 → 返回第一个子节点
   *   2. 无子节点 → 找同级后兄弟
   *   3. 无后兄弟 → 向上回溯找祖先的后兄弟
   */
  function findNextBlockInTreeOrder(blockId: string): BlockWithPos | undefined {
    const block = blocks.value.find(b => b.id === blockId)
    if (!block) return undefined

    // 1. 有子节点 → 返回第一个子节点
    const children = getSortedChildren(blocks.value, block.id, block.pageId)
    if (children.length > 0) {
      return children[0]
    }

    // 2. 找同级后兄弟
    const nextSibling = getNextSibling(blocks.value, block)
    if (nextSibling) {
      return nextSibling
    }

    // 3. 向上回溯找祖先的后兄弟
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

  /** 与上一个 Block 合并（跨层级，文档序前驱） */
  async function mergeWithPrevious(blockId: string) {
    const block = blocks.value.find(b => b.id === blockId)
    if (!block) return

    const prev = findPreviousBlockInTreeOrder(blockId)
    if (!prev) return

    const prevContentLen = prev.content.length
    prev.content += block.content
    // ProseMirror position = text offset + 1 (paragraph opening tag)
    const cursorPos = prevContentLen + 1
    prev.updatedAt = Date.now()
    await storage.saveBlock(prev)

    await deleteBlock(blockId)
    return { id: prev.id, cursorPos }
  }

  /** 缩进（成为前一个兄弟节点的子节点） */
  async function indent(blockId: string) {
    const block = blocks.value.find(b => b.id === blockId)
    if (!block) return

    const prev = getPrevSibling(blocks.value, block)
    if (!prev) return

    // 更新 parentId 和 leftId
    block.parentId = prev.id

    // 找到新父节点的最后一个子节点
    const children = blocks.value.filter(b => b.parentId === prev.id)
    const sortedChildren = sortByLeftId(children)
    const lastChild = sortedChildren[sortedChildren.length - 1]

    block.leftId = lastChild?.id ?? null
    // 修复：不应该修改 createdAt
    block.updatedAt = Date.now()

    _scheduleSave(block)
  }

  /** 反缩进（提升到父节点的层级） */
  async function outdent(blockId: string) {
    const block = blocks.value.find(b => b.id === blockId)
    if (!block || !block.parentId) return // 已经是顶级

    const parent = blocks.value.find(b => b.id === block.parentId)
    if (!parent) return

    // 更新 parentId
    const newParentId = parent.parentId
    block.parentId = newParentId

    // 找到新父节点的最后一个子节点
    const siblings = blocks.value.filter(b => b.parentId === newParentId && b.pageId === block.pageId)
    const sortedSiblings = sortByLeftId(siblings)
    const lastSibling = sortedSiblings[sortedSiblings.length - 1]
    block.leftId = lastSibling?.id ?? null

    block.updatedAt = Date.now()

    _scheduleSave(block)
  }

  /**
   * 移动 Block 到新位置
   *
   * @param opts.blockId       被移动的 Block ID
   * @param opts.fromParentId  原始 parentId（移动前）
   * @param opts.toParentId    目标 parentId（移动后）
   * @param opts.newIndex      在目标 parent 下的新位置（0-based）
   */
  async function moveBlock(opts: {
    blockId: string
    fromParentId: string | null
    toParentId: string | null
    newIndex: number
  }) {
    const { blockId, fromParentId, toParentId, newIndex } = opts
    const block = blocks.value.find(b => b.id === blockId)
    if (!block) return

    // 验证 1：循环检测
    if (isDescendantOf(toParentId, blockId)) {
      console.warn('[moveBlock] 禁止：将 block 移动到自己的子树中', { blockId, toParentId })
      return
    }

    // 验证 2：检查是否移动到原位置
    if (fromParentId === toParentId) {
      const currentSiblings = getSortedSiblings(blocks.value, block, true)
      const currentIndex = currentSiblings.findIndex(s => s.id === blockId)
      if (newIndex === currentIndex || newIndex === currentIndex + 1) {
        return // 无变化
      }
    }

    // 验证 3：newIndex 范围检查
    const targetSiblings = getSortedChildren(blocks.value, toParentId, block.pageId, blockId)
    const clampedIndex = Math.max(0, Math.min(newIndex, targetSiblings.length))

    // 更新 block 的 parentId
    block.parentId = toParentId

    // 重新计算所有相关 Block 的 leftId
    if (clampedIndex === 0) {
      block.leftId = null
      if (targetSiblings.length > 0) {
        const firstSibling = targetSiblings[0]
        firstSibling.leftId = block.id
        firstSibling.updatedAt = Date.now()
        _scheduleSave(firstSibling)
      }
    } else if (clampedIndex >= targetSiblings.length) {
      const lastSibling = targetSiblings[targetSiblings.length - 1]
      block.leftId = lastSibling?.id ?? null
    } else {
      const prevSibling = targetSiblings[clampedIndex - 1]
      const nextSibling = targetSiblings[clampedIndex]
      block.leftId = prevSibling?.id ?? null
      if (nextSibling) {
        nextSibling.leftId = block.id
        nextSibling.updatedAt = Date.now()
        _scheduleSave(nextSibling)
      }
    }

    block.updatedAt = Date.now()
    _scheduleSave(block)
  }

  /**
   * 删除 Block（批量删除，保证事务性）
   */
  async function deleteBlock(blockId: string) {
    // 1. 收集所有待删除的 Block IDs（包括子节点）
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

    // 2. 批量取消 pending saves
    for (const id of toDelete) {
      pendingSaves.get(id)?.cancel()
      pendingSaves.delete(id)
    }

    // 3. 找到当前 Block 的下一个兄弟，更新其 leftId
    const block = blocks.value.find(b => b.id === blockId)
    if (block) {
      const siblings = getSortedSiblings(blocks.value, block)
      const blockIndex = siblings.findIndex(b => b.id === blockId)
      if (blockIndex < siblings.length - 1) {
        const nextSibling = siblings[blockIndex + 1]
        nextSibling.leftId = block.leftId
        nextSibling.updatedAt = Date.now()
        _scheduleSave(nextSibling)
      }
    }

    // 4. 批量从内存移除
    blocks.value = blocks.value.filter(b => !toDelete.has(b.id))

    // 5. 批量从 IDB 删除
    try {
      await storage.deleteBlockCascade(Array.from(toDelete))
    } catch (error) {
      console.error('[deleteBlock] Failed to delete blocks from IDB:', error)
      // 注意：这里内存已删除，但 IDB 可能部分失败，需要考虑恢复机制
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

    // 同步更新 Page 的 updatedAt
    const pageStore = usePageStore()
    const page = pageStore.getPage(block.pageId)
    if (page) {
      page.updatedAt = Date.now()
      await storage.updatePage(page)
    }
  }

  /** 更新 Block 的格式 */
  async function updateBlockFormat(blockId: string, format: Record<string, any>) {
    const block = blocks.value.find(b => b.id === blockId)
    if (!block) return

    block.format = { ...block.format, ...format }
    block.updatedAt = Date.now()
    _scheduleSave(block)
  }

  /** 更新 Block 的属性 */
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
    splitBlock,
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
