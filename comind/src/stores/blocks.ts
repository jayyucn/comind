import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Block, BlockWithPos } from '../types/block'
import { storage } from '../storage/indexedDB'
import { generateUUID } from '../utils/id'
import { debounce } from '../utils/debounce'
import {
  calculateNewLeft,
  calculateOutdentLeft,
  calculateIndentLeft,
  reindexLeftValues,
  validateLeftValues
} from '../utils/leftCalculator'
import { invalidateTagCache } from '../composables/useTagFilter'
import { usePageStore } from './pages'

const LEFT_STEP = 100 // 同级节点初始间隔

/** 在 Block 数组中查找（工具函数，模块级别，不依赖 store） */
function findBlockById(id: string, blocks: BlockWithPos[]): BlockWithPos | undefined {
  return blocks.find(b => b.id === id)
}

export const useBlockStore = defineStore('blocks', () => {
  const blocks = ref<BlockWithPos[]>([])
  const currentPageId = ref<string>('')
  const loading = ref(false)

  /** 按 left 排序的扁平 Block 列表 */
  const sortedBlocks = computed(() => [...blocks.value].sort((a, b) => a.left - b.left))

  /** 构建 Block 树（parentId → children[]） */
  const blockTree = computed(() => {
    const map = new Map<string | null, BlockWithPos[]>()
    for (const block of blocks.value) {
      const list = map.get(block.parentId) ?? []
      list.push(block)
      map.set(block.parentId, list)
    }
    // 每组内按 left 排序
    for (const [key, list] of map) {
      map.set(key, list.sort((a, b) => a.left - b.left))
    }
    return map
  })

  /** 获取某 Block 的直接子节点 */
  function getChildren(parentId: string): BlockWithPos[] {
    return blockTree.value.get(parentId) ?? []
  }

  /** 加载指定 Page 的 Block 树 */
  async function loadPage(pageId: string) {
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
   * 对 siblings 数组重排 left 值（完全重排策略）
   * @param siblings 按 left 排序的 Block 数组
   * @param step 间隔，默认 100
   */
  function recalculateLeftValues(siblings: BlockWithPos[], step = LEFT_STEP) {
    siblings.forEach((block, index) => {
      block.left = step * (index + 1)
    })
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

    // 如果传入了 left 值，直接使用；否则计算新的 left 值
    let left: number
    if (opts.left !== undefined) {
      left = opts.left
    } else {
      const siblings = blocks.value.filter(b => b.parentId === parentId && b.pageId === opts.pageId)
      left = calculateNewLeft(siblings)
    }

    const block: BlockWithPos = {
      id: generateUUID(),
      content: opts.content,
      parentId,
      pageId: opts.pageId,
      left,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isPage: opts.isPage ?? false,
      title: opts.title,
      properties: opts.properties,
      collapsed: opts.collapsed ?? false,
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
    block.updatedAt = new Date().toISOString()
    await storage.saveBlock(block)

    const childBlocks = getChildren(block.id)

    //是否创建子节点
    const isCreateChild = !isCollapsed && childBlocks.length > 0

    const newParentId = isCreateChild ? block.id : block.parentId

    const siblings = blocks.value.filter(
      b => b.parentId === newParentId && b.pageId === block.pageId
    )
    if(isCreateChild) {
      blockId = ''
    }

    const newBlock = await createBlock({
      pageId: block.pageId,
      content: after,
      parentId: newParentId,
      left: calculateNewLeft(siblings,  blockId),
      pos: 0
    })

    return newBlock
  }

  /**
   * 找到指定 Block 在文档序中的前一个 Block（树前序遍历前驱）。
   * 算法：
   *   1. 找同级前兄弟（same parentId, left < block.left, left 最大的）
   *   2. 有前兄弟 → 取其最深末端子节点
   *   3. 无前兄弟 → 返回父节点（顶层块无前驱）
   */
  function findPreviousBlockInTreeOrder(blockId: string): BlockWithPos | undefined {
    const block = findBlockById(blockId, blocks.value)
    if (!block) return undefined

    const siblings = blocks.value
      .filter(b => b.parentId === block.parentId && b.pageId === block.pageId && b.left < block.left)
      .sort((a, b) => b.left - a.left)

    const prevSibling = siblings[0]

    if (prevSibling) {
      // 有前兄弟 → 找最深末端子节点
      let current: BlockWithPos = prevSibling
      const childrenOf = (id: string) =>
        blocks.value
          .filter(b => b.parentId === id && b.pageId === block.pageId)
          .sort((a, b) => b.left - a.left)

      while (true) {
        const children = childrenOf(current.id)
        if (children.length === 0) break
        current = children[children.length - 1] // 同级 left 最大的子节点
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
      .sort((a, b) => a.left - b.left)
    if (children.length > 0) {
      return children[0]
    }

    // 2. 找同级后兄弟
    const siblings = blocks.value
      .filter(b => b.parentId === block.parentId && b.pageId === block.pageId && b.left > block.left)
      .sort((a, b) => a.left - b.left)
    if (siblings.length > 0) {
      return siblings[0]
    }

    // 3. 向上回溯找祖先的后兄弟
    let currentParentId = block.parentId
    while (currentParentId) {
      const parent = findBlockById(currentParentId, blocks.value)
      if (!parent) break

      const parentSiblings = blocks.value
        .filter(b => b.parentId === parent.parentId && b.pageId === block.pageId && b.left > parent.left)
        .sort((a, b) => a.left - b.left)
      if (parentSiblings.length > 0) {
        return parentSiblings[0]
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
    prev.updatedAt = new Date().toISOString()
    await storage.saveBlock(prev)

    await deleteBlock(blockId)
    return { id: prev.id, cursorPos }
  }

  /** 缩进（成为前一个兄弟节点的子节点） */
  async function indent(blockId: string) {
    const block = findBlockById(blockId, blocks.value)
    if (!block) return

    const siblings = blocks.value
      .filter(b => b.parentId === block.parentId && b.pageId === block.pageId && b.left < block.left)
      .sort((a, b) => b.left - a.left)

    const prev = siblings[0]
    if (!prev) return

    // 计算新的 left 值
    const parent = prev
    const children = blocks.value.filter(b => b.parentId === parent.id)
    block.parentId = parent.id
    block.left = calculateIndentLeft(parent, children)
    block.updatedAt = new Date().toISOString()

    _scheduleSave(block)
  }

  /** 反缩进（提升到父节点的层级） */
  async function outdent(blockId: string) {
    const block = findBlockById(blockId, blocks.value)
    if (!block || !block.parentId) return // 已经是顶级

    const parent = findBlockById(block.parentId, blocks.value)
    if (!parent) return

    // 计算新的 left 值
    const newParentId = parent.parentId
    const siblings = blocks.value.filter(b => b.parentId === newParentId && b.pageId === block.pageId)
    block.parentId = newParentId
    block.left = calculateOutdentLeft(parent, siblings)
    block.updatedAt = new Date().toISOString()

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
    const block = findBlockById(blockId, blocks.value)
    if (!block) return

    // 1. 循环检测：阻止将 block 移动到自己的子树中
    if (isDescendantOf(toParentId, blockId)) {
      console.warn('[moveBlock] 禁止：将 block 移动到自己的子树中', { blockId, toParentId })
      return
    }

    const pageId = block.pageId

    // 2. 同一 parent 内移动
    if (fromParentId === toParentId) {
      const siblings = blocks.value
        .filter(b => b.parentId === toParentId && b.pageId === pageId)
        .sort((a, b) => a.left - b.left)

      const fromIndex = siblings.findIndex(b => b.id === blockId)
      if (fromIndex === -1) return

      const [moved] = siblings.splice(fromIndex, 1)
      const targetIndex = Math.min(newIndex, siblings.length)
      siblings.splice(targetIndex, 0, moved)
      recalculateLeftValues(siblings)

    } else {
      // 3. 跨 parent 移动

      // 3a. 先更新 block 的 parentId（必须在获取 source siblings 之后）
      block.parentId = toParentId

      // 3b. 从 source parent 移除后重排
      const sourceSiblings = blocks.value
        .filter(b => b.parentId === fromParentId && b.pageId === pageId && b.id !== blockId)
        .sort((a, b) => a.left - b.left)
      recalculateLeftValues(sourceSiblings)

      // 3c. 插入到 target parent 后重排
      const targetSiblings = blocks.value
        .filter(b => b.parentId === toParentId && b.pageId === pageId && b.id !== blockId)
        .sort((a, b) => a.left - b.left)
      const targetIndex = Math.min(newIndex, targetSiblings.length)
      targetSiblings.splice(targetIndex, 0, block)
      recalculateLeftValues(targetSiblings)
    }

    // 4. 更新 updatedAt 并批量保存（防抖）
    const updatedBlocks = blocks.value.filter(
      b => b.pageId === pageId && (b.parentId === fromParentId || b.parentId === toParentId)
    )
    for (const b of updatedBlocks) {
      b.updatedAt = new Date().toISOString()
      _scheduleSave(b)
    }
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

    blocks.value = blocks.value.filter(b => b.id !== blockId)
    await storage.deleteBlock(blockId)
    invalidateTagCache()
  }

  /** 更新 Block 内容 */
  async function updateBlockContent(blockId: string, content: string) {
    const block = findBlockById(blockId, blocks.value)
    if (!block) return
    block.content = content
    block.updatedAt = new Date().toISOString()
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

  /** 重新索引 left 值以修复间隙和确保一致性 */
  async function reindexBlocks() {
    const updates = reindexLeftValues(blocks.value)

    for (const update of updates) {
      const block = findBlockById(update.id, blocks.value)
      if (block && block.left !== update.left) {
        block.left = update.left
        block.updatedAt = new Date().toISOString()
        _scheduleSave(block)
      }
    }
  }

  /** 验证 left 值的一致性 */
  function validateBlocks() {
    return validateLeftValues(blocks.value)
  }

  /** 更新 Block 的折叠状态并持久化 */
  async function updateBlockCollapsed(blockId: string, collapsed: boolean) {
    const block = findBlockById(blockId, blocks.value)
    if (!block) return
    block.collapsed = collapsed
    block.updatedAt = new Date().toISOString()
    _scheduleSave(block)
  }

  return {
    blocks,
    sortedBlocks,
    blockTree,
    currentPageId,
    loading,
    getChildren,
    loadPage,
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
    reindexBlocks,
    validateBlocks,
    isDescendantOf,
    updateBlockCollapsed
  }
})
