import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Block } from '../types/block'
import { storage } from '../storage/indexedDB'
import { generateUUID } from '../utils/id'
import { debounce } from '../utils/debounce'

const LEFT_STEP = 100 // 同级节点初始间隔

function findBlockById(id: string, blocks: Block[]): Block | undefined {
  return blocks.find(b => b.id === id)
}

export const useBlockStore = defineStore('blocks', () => {
  const blocks = ref<Block[]>([])
  const currentPageId = ref<string>('')
  const loading = ref(false)

  /** 按 left 排序的扁平 Block 列表 */
  const sortedBlocks = computed(() => [...blocks.value].sort((a, b) => a.left - b.left))

  /** 构建 Block 树（parentId → children[]） */
  const blockTree = computed(() => {
    const map = new Map<string | null, Block[]>()
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
  function getChildren(parentId: string): Block[] {
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

  /** 持久化保存（防抖 300ms） */
  const _saveBlock = debounce(async (block: Block) => {
    await storage.saveBlock(block)
  }, 300)

  async function saveBlock(block: Block) {
    _saveBlock(block)
  }

  /** 创建新 Block */
  async function createBlock(
    opts: Partial<Block> & { pageId: string; content: string }
  ): Promise<Block> {
    const parentId = opts.parentId ?? null
    
    // 如果传入了 left 值，直接使用；否则计算新的 left 值
    let left: number
    if (opts.left !== undefined) {
      left = opts.left
    } else {
      const siblings = blocks.value.filter(b => b.parentId === parentId && b.pageId === opts.pageId)
      const maxLeft = siblings.length > 0 ? Math.max(...siblings.map(b => b.left)) : 0
      left = maxLeft + LEFT_STEP
    }

    const block: Block = {
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
      folded: opts.folded ?? false
    }

    blocks.value.push(block)
    await storage.saveBlock(block)
    return block
  }

  /** 在光标位置拆分 Block */
  async function splitBlock(blockId: string, cursorPos: number) {
    const block = findBlockById(blockId, blocks.value)
    if (!block) return

    const before = block.content.slice(0, cursorPos)
    const after = block.content.slice(cursorPos)

    // 更新当前 Block
    block.content = before
    block.updatedAt = new Date().toISOString()
    _saveBlock(block)

    // 在当前 Block 之后插入新 Block
    const siblings = blocks.value.filter(
      b => b.parentId === block.parentId && b.pageId === block.pageId && b.left > block.left
    )
    const minLeft = siblings.length > 0 ? Math.min(...siblings.map(b => b.left)) : block.left + LEFT_STEP

    // 调整后续兄弟节点位置
    for (const s of siblings) {
      s.left += LEFT_STEP
      _saveBlock(s)
    }

    const newBlock = await createBlock({
      pageId: block.pageId,
      content: after,
      parentId: block.parentId,
      left: minLeft
    })

    return newBlock
  }

  /** 与上一个 Block 合并 */
  async function mergeWithPrevious(blockId: string) {
    const block = findBlockById(blockId, blocks.value)
    if (!block) return

    const siblings = blocks.value
      .filter(b => b.parentId === block.parentId && b.pageId === block.pageId && b.left < block.left)
      .sort((a, b) => b.left - a.left)

    const prev = siblings[0]
    if (!prev) return

    prev.content += block.content
    prev.updatedAt = new Date().toISOString()
    await _saveBlock(prev)

    await deleteBlock(blockId)
    return prev.id
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

    // 新的 left = 前一个节点左侧值
    block.parentId = prev.id
    block.left = 0
    block.updatedAt = new Date().toISOString()

    // 重新计算所有子节点的 left（确保子节点排在父节点后面）
    const descendants = blocks.value.filter(b => b.parentId === prev.id && b.id !== blockId)
    if (descendants.length === 0) {
      block.left = 1
    } else {
      const maxLeft = Math.max(...descendants.map(d => d.left))
      block.left = maxLeft + LEFT_STEP
    }

    await _saveBlock(block)
  }

  /** 反缩进（提升到父节点的层级） */
  async function outdent(blockId: string) {
    const block = findBlockById(blockId, blocks.value)
    if (!block || !block.parentId) return // 已经是顶级

    const parent = findBlockById(block.parentId, blocks.value)
    if (!parent) return

    block.parentId = parent.parentId
    block.left = parent.left + 1
    block.updatedAt = new Date().toISOString()

    await _saveBlock(block)
  }

  /** 删除 Block */
  async function deleteBlock(blockId: string) {
    // 递归删除子节点
    const children = blocks.value.filter(b => b.parentId === blockId)
    for (const child of children) {
      await deleteBlock(child.id)
    }

    blocks.value = blocks.value.filter(b => b.id !== blockId)
    await storage.deleteBlock(blockId)
  }

  /** 更新 Block 内容 */
  async function updateBlockContent(blockId: string, content: string) {
    const block = findBlockById(blockId, blocks.value)
    if (!block) return
    block.content = content
    block.updatedAt = new Date().toISOString()
    await _saveBlock(block)
  }

  return {
    blocks,
    sortedBlocks,
    blockTree,
    currentPageId,
    loading,
    getChildren,
    loadPage,
    saveBlock,
    createBlock,
    splitBlock,
    mergeWithPrevious,
    indent,
    outdent,
    deleteBlock,
    updateBlockContent
  }
})
