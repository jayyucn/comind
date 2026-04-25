import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Block, BlockWithPos } from '../types/block'
import { storage } from '../storage/indexedDB'
import { generateUUID } from '../utils/id'
import { debounce } from '../utils/debounce'
import { invalidateTagCache } from '../composables/useTagFilter'
import { usePageStore } from './pages'

/** 在 Block 数组中查找（工具函数，模块级别，不依赖 store） */
function findBlockById(id: string, blocks: BlockWithPos[]): BlockWithPos | undefined {
  return blocks.find(b => b.id === id)
}

/** 按 leftId 排序的辅助函数 */
function sortByLeftId(blocks: BlockWithPos[]): BlockWithPos[] {
  return blocks.sort((a, b) => {
    if (!a.leftId) return -1
    if (!b.leftId) return 1
    return a.leftId.localeCompare(b.leftId)
  })
}

export const useBlockStore = defineStore('blocks', () => {
  const blocks = ref<BlockWithPos[]>([])
  const currentPageId = ref<string>('')
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
    loading.value = true
    try {
      blocks.value = await storage.getBlockTree(pageId)
      currentPageId.value = pageId
    } finally {
      loading.value = false
    }
  }

  /** 每个 Block 独立的防抖保存（Map 确保删除时能取消 pending save） */
  const pendingSaves = new Map<string, ReturnType<typeof debounce<typeof _doSave>>>()

  async function _doSave(block: Block) {
    // 检查 block 是否仍在内存中（可能被删了）
    if (!findBlockById(block.id, blocks.value)) return
    await storage.saveBlock(block)
    pendingSaves.delete(block.id)
  }

  function _scheduleSave(block: Block) {
    // 取消该 block 之前的 pending save
    pendingSaves.get(block.id)?.cancel()
    const d = debounce(_doSave, 300)
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
      const ancestor = findBlockById(current, blocks.value)
      current = ancestor?.parentId ?? null
    }
    return false
  }

  /** 创建新 Block */
  async function createBlock(
    opts: Partial<BlockWithPos> & { pageId: string; content: string }
  ): Promise<BlockWithPos> {
    const parentId = opts.parentId ?? null

    // 找到最后一个同级 Block，设置 leftId
    const siblings = blocks.value.filter(b => b.parentId === parentId && b.pageId === opts.pageId)
    const sortedSiblings = sortByLeftId(siblings)
    const lastSibling = sortedSiblings[sortedSiblings.length - 1]

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

  /** 在光标位置拆分 Block
   * @param blockId 要拆分的 Block ID
   * @param cursorPos 光标位置
   * @param isCollapsed 当前 Block 是否处于折叠状态
   *   - false: 创建为当前 Block 的子节点
   *   - true: 创建为当前 Block 的兄弟节点
   */
  async function splitBlock(blockId: string, cursorPos: number, isCollapsed?: boolean) {
    const block = findBlockById(blockId, blocks.value)
    if (!block) return

    const textOffset = Math.max(0, cursorPos - 1)
    const before = block.content.slice(0, textOffset)
    const after = block.content.slice(textOffset)
    block.content = before
    block.updatedAt = Date.now()
    await storage.saveBlock(block)

    const childBlocks = getChildren(block.id)

    //是否创建子节点
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
   * 找到指定 Block 在文档序中的前一个 Block（树前序遍历前驱）。
   * 算法：
   *   1. 找同级前兄弟（same parentId, 按 leftId 排序）
   *   2. 有前兄弟 → 取其最深末端子节点
   *   3. 无前兄弟 → 返回父节点（顶层块无前驱）
   */
  function findPreviousBlockInTreeOrder(blockId: string): BlockWithPos | undefined {
    const block = findBlockById(blockId, blocks.value)
    if (!block) return undefined

    const siblings = blocks.value
      .filter(b => b.parentId === block.parentId && b.pageId === block.pageId)
      .sort((a, b) => {
        if (a.id === block.id) return 1
        if (b.id === block.id) return -1
        if (!a.leftId) return -1
        if (!b.leftId) return 1
        return a.leftId.localeCompare(b.leftId)
      })

    const blockIndex = siblings.findIndex(b => b.id === block.id)
    const prevSibling = blockIndex > 0 ? siblings[blockIndex - 1] : undefined

    if (prevSibling) {
      // 有前兄弟 → 找最深末端子节点
      let current: BlockWithPos = prevSibling
      const childrenOf = (id: string) =>
        blocks.value
          .filter(b => b.parentId === id && b.pageId === block.pageId)
          .sort((a, b) => {
            if (!a.leftId) return -1
            if (!b.leftId) return 1
            return a.leftId.localeCompare(b.leftId)
          })

      while (true) {
        const children = childrenOf(current.id)
        if (children.length === 0) break
        current = children[children.length - 1] // 同级最后一个子节点
      }
      return current
    }

    // 无前兄弟 → 返回父节点（顶层块父节点为 null，无前驱）
    return block.parentId
      ? findBlockById(block.parentId, blocks.value)
      : undefined
  }

  /**
   * 找到指定 Block 在文档序中的下一个 Block（树前序遍历后继）。
   * 算法：
   *   1. 有子节点 → 返回第一个子节点
   *   2. 无子节点 → 找同级后兄弟
   *   3. 无后兄弟 → 向上回溯找祖先的后兄弟
   */
  function findNextBlockInTreeOrder(blockId: string): BlockWithPos | undefined {
    const block = findBlockById(blockId, blocks.value)
    if (!block) return undefined

    // 1. 有子节点 → 返回第一个子节点
    const children = blocks.value
      .filter(b => b.parentId === block.id && b.pageId === block.pageId)
      .sort((a, b) => {
        if (!a.leftId) return -1
        if (!b.leftId) return 1
        return a.leftId.localeCompare(b.leftId)
      })
    if (children.length > 0) {
      return children[0]
    }

    // 2. 找同级后兄弟
    const siblings = blocks.value
      .filter(b => b.parentId === block.parentId && b.pageId === block.pageId)
      .sort((a, b) => {
        if (a.id === block.id) return -1
        if (b.id === block.id) return 1
        if (!a.leftId) return -1
        if (!b.leftId) return 1
        return a.leftId.localeCompare(b.leftId)
      })

    const blockIndex = siblings.findIndex(b => b.id === block.id)
    const nextSibling = blockIndex < siblings.length - 1 ? siblings[blockIndex + 1] : undefined
    if (nextSibling) {
      return nextSibling
    }

    // 3. 向上回溯找祖先的后兄弟
    let currentParentId = block.parentId
    while (currentParentId) {
      const parent = findBlockById(currentParentId, blocks.value)
      if (!parent) break

      const parentSiblings = blocks.value
        .filter(b => b.parentId === parent.parentId && b.pageId === block.pageId)
        .sort((a, b) => {
          if (a.id === parent.id) return -1
          if (b.id === parent.id) return 1
          if (!a.leftId) return -1
          if (!b.leftId) return 1
          return a.leftId.localeCompare(b.leftId)
        })

      const parentIndex = parentSiblings.findIndex(b => b.id === parent.id)
      const nextParentSibling = parentIndex < parentSiblings.length - 1 ? parentSiblings[parentIndex + 1] : undefined
      if (nextParentSibling) {
        return nextParentSibling
      }

      currentParentId = parent.parentId
    }

    return undefined
  }

  /** 与上一个 Block 合并（跨层级，文档序前驱） */
  async function mergeWithPrevious(blockId: string) {
    const block = findBlockById(blockId, blocks.value)
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
    const block = findBlockById(blockId, blocks.value)
    if (!block) return

    const siblings = blocks.value
      .filter(b => b.parentId === block.parentId && b.pageId === block.pageId)
      .sort((a, b) => {
        if (a.id === block.id) return 1
        if (b.id === block.id) return -1
        if (!a.leftId) return -1
        if (!b.leftId) return 1
        return a.leftId.localeCompare(b.leftId)
      })

    const blockIndex = siblings.findIndex(b => b.id === block.id)
    const prev = blockIndex > 0 ? siblings[blockIndex - 1] : undefined
    if (!prev) return

    // 更新 parentId 和 leftId
    block.parentId = prev.id
    
    // 找到新父节点的最后一个子节点
    const children = blocks.value.filter(b => b.parentId === prev.id)
    const sortedChildren = sortByLeftId(children)
    const lastChild = sortedChildren[sortedChildren.length - 1]
    block.leftId = lastChild?.id ?? null
    block.createdAt = Date.now()
    block.updatedAt = Date.now()

    _scheduleSave(block)
  }

  /** 反缩进（提升到父节点的层级） */
  async function outdent(blockId: string) {
    const block = findBlockById(blockId, blocks.value)
    if (!block || !block.parentId) return // 已经是顶级

    const parent = findBlockById(block.parentId, blocks.value)
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
    const { blockId, toParentId, newIndex } = opts
    const block = findBlockById(blockId, blocks.value)
    if (!block) return

    // 1. 循环检测：阻止将 block 移动到自己的子树中
    if (isDescendantOf(toParentId, blockId)) {
      console.warn('[moveBlock] 禁止：将 block 移动到自己的子树中', { blockId, toParentId })
      return
    }

    const pageId = block.pageId

    // 2. 更新 block 的 parentId
    block.parentId = toParentId

    // 3. 重新计算所有相关 Block 的 leftId
    // 这里简化处理，只更新移动的 Block 的 leftId
    // 实际应用中可能需要更复杂的逻辑来维护 leftId 链
    
    // 找到目标位置的前后 Block
    const targetSiblings = blocks.value
      .filter(b => b.parentId === toParentId && b.pageId === pageId && b.id !== blockId)
      .sort((a, b) => {
        if (!a.leftId) return -1
        if (!b.leftId) return 1
        return a.leftId.localeCompare(b.leftId)
      })

    if (newIndex === 0) {
      // 移动到第一个位置
      block.leftId = null
      // 更新原第一个 Block 的 leftId 为当前 Block 的 id
      if (targetSiblings.length > 0) {
        const firstSibling = targetSiblings[0]
        firstSibling.leftId = block.id
        firstSibling.updatedAt = Date.now()
        _scheduleSave(firstSibling)
      }
    } else if (newIndex >= targetSiblings.length) {
      // 移动到最后一个位置
      const lastSibling = targetSiblings[targetSiblings.length - 1]
      block.leftId = lastSibling?.id ?? null
    } else {
      // 移动到中间位置
      const prevSibling = targetSiblings[newIndex - 1]
      const nextSibling = targetSiblings[newIndex]
      block.leftId = prevSibling?.id ?? null
      if (nextSibling) {
        nextSibling.leftId = block.id
        nextSibling.updatedAt = Date.now()
        _scheduleSave(nextSibling)
      }
    }

    // 4. 更新 updatedAt 并保存
    block.updatedAt = Date.now()
    _scheduleSave(block)
  }

  /** 删除 Block（删除前取消该 block 的 pending save，防止死块复活） */
  async function deleteBlock(blockId: string) {
    // 取消该 block 及所有子 block 的 pending saves
    pendingSaves.get(blockId)?.cancel()
    pendingSaves.delete(blockId)

    // 递归删除子节点
    const children = blocks.value.filter(b => b.parentId === blockId)
    for (const child of children) {
      await deleteBlock(child.id)
    }

    // 找到当前 Block 的下一个兄弟，更新其 leftId 为当前 Block 的 leftId
    const block = findBlockById(blockId, blocks.value)
    if (block) {
      const siblings = blocks.value.filter(b => b.parentId === block.parentId && b.pageId === block.pageId)
      const sortedSiblings = sortByLeftId(siblings)
      const blockIndex = sortedSiblings.findIndex(b => b.id === blockId)
      if (blockIndex < sortedSiblings.length - 1) {
        const nextSibling = sortedSiblings[blockIndex + 1]
        nextSibling.leftId = block.leftId
        nextSibling.updatedAt = Date.now()
        _scheduleSave(nextSibling)
      }
    }

    blocks.value = blocks.value.filter(b => b.id !== blockId)
    await storage.deleteBlock(blockId)
    invalidateTagCache()
  }

  /** 更新 Block 内容 */
  async function updateBlockContent(blockId: string, content: string) {
    const block = findBlockById(blockId, blocks.value)
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
    const block = findBlockById(blockId, blocks.value)
    if (!block) return
    block.format = { ...block.format, ...format }
    block.updatedAt = Date.now()
    _scheduleSave(block)
  }

  /** 更新 Block 的属性 */
  async function updateBlockProperties(blockId: string, properties: Record<string, any>) {
    const block = findBlockById(blockId, blocks.value)
    if (!block) return
    block.properties = { ...block.properties, ...properties }
    block.updatedAt = Date.now()
    _scheduleSave(block)
  }

  return {
    blocks,
    sortedBlocks,
    blockTree,
    currentPageId,
    loading,
    getChildren,
    loadPageBlocks,
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
