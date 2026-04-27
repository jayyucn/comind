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
  SAVE_DEBOUNCE_MS
} from '../utils/block-helpers'

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

  /** 创建新 Block */
  async function createBlock(
    opts: Partial<Block> & { pageId: string; content: string }
  ): Promise<Block> {
    const parentId = opts.parentId ?? null
    const siblings = getSortedChildren(blocks.value, parentId, opts.pageId)
    const lastPos = siblings.length > 0 ? siblings[siblings.length - 1].pos : null
    const newPos = calcInsertPos(lastPos, null)

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

  /** 在光标位置拆分 Block */
  async function splitBlock(blockId: string, cursorPos: number, isCollapsed?: boolean) {
    const block = blocks.value.find(b => b.id === blockId)
    if (!block) return

    const textOffset = pmPosToTextOffset(cursorPos)
    const before = block.content.slice(0, textOffset)
    const after = block.content.slice(textOffset)

    block.content = before
    block.updatedAt = Date.now()
    await storage.saveBlock(block)

    const childBlocks = getChildren(block.id)
    const isCreateChild = isCollapsed || childBlocks.length > 0
    const newParentId = isCreateChild ? block.id : block.parentId

    // 计算新 Block 的位置
    let newPos: number
    if (isCreateChild) {
      // 作为子节点：插入到现有子节点末尾
      const lastChildPos = childBlocks.length > 0 ? childBlocks[childBlocks.length - 1].pos : null
      newPos = calcInsertPos(lastChildPos, null)
    } else {
      // 作为兄弟节点：插入到当前 Block 之后
      const nextSibling = getNextSibling(blocks.value, block)
      newPos = calcInsertPos(block.pos, nextSibling?.pos ?? null)
    }

    const newBlock = await createBlock({
      pageId: block.pageId,
      content: after,
      parentId: newParentId,
      pos: newPos
    })

    return newBlock
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
    const newPos = calcInsertPos(lastPos, null)

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
    const newPos = calcInsertPos(parent.pos, nextSibling?.pos ?? null)

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
    block.pos = calcInsertPos(prevPos, nextPos)
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
