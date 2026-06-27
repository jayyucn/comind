/**
 * Core Layer - Block 服务
 *
 * 提供 Block 相关的业务逻辑，与框架无关。
 */

import type {
  Block,
  BlockCreateOptions,
  BlockUpdateOptions,
  TreeNode,
  BlockPath,
} from '../types'
import type { BlockRepository, StorageAdapter } from '../storage/adapter'

/**
 * Block Service 选项
 */
export interface BlockServiceOptions {
  storage: StorageAdapter
}

/**
 * Block Service
 *
 * 提供 Block 相关的业务逻辑，包括：
 * - Block CRUD 操作
 * - 树形结构操作
 * - Gap Sort 排序
 */
export class BlockService {
  private storage: StorageAdapter

  constructor(options: BlockServiceOptions) {
    this.storage = options.storage
  }

  /**
   * 获取 Block Repository
   */
  get repository(): BlockRepository {
    return this.storage.blocks
  }

  /**
   * 根据 ID 获取 Block
   */
  async getById(id: string): Promise<Block | undefined> {
    return this.repository.findById(id)
  }

  /**
   * 根据页面 ID 获取所有 Block
   */
  async getByPageId(pageId: string): Promise<Block[]> {
    return this.repository.findByPageId(pageId)
  }

  /**
   * 根据父级 ID 获取子 Block
   */
  async getChildren(parentId: string | null): Promise<Block[]> {
    return this.repository.findByParentId(parentId)
  }

  /**
   * 创建 Block
   */
  async create(options: BlockCreateOptions): Promise<Block> {
    const parentId = options.parentId ?? null

    return this.repository.create({
      ...options,
      parentId,
      type: options.type ?? 'bullet',
    })
  }

  /**
   * 更新 Block
   */
  async update(id: string, options: BlockUpdateOptions): Promise<Block> {
    return this.repository.update(id, options)
  }

  /**
   * 删除 Block（包含所有子 Block）
   */
  async delete(id: string): Promise<void> {
    const block = await this.repository.findById(id)
    if (!block) return

    // 递归删除子 Block
    const children = await this.repository.findByParentId(id)
    for (const child of children) {
      await this.delete(child.id)
    }

    // 删除 Block
    await this.repository.delete(id)
  }

  /**
   * 构建 Block 树
   */
  async buildTree(pageId: string): Promise<TreeNode[]> {
    const blocks = await this.repository.findByPageId(pageId)
    const blockMap = new Map<string, TreeNode>()

    // 创建所有节点
    for (const block of blocks) {
      blockMap.set(block.id, {
        id: block.id,
        block,
        children: [],
      })
    }

    // 构建树形结构
    const roots: TreeNode[] = []
    for (const block of blocks) {
      const node = blockMap.get(block.id)!
      if (block.parentId === null) {
        roots.push(node)
      } else {
        const parent = blockMap.get(block.parentId)
        if (parent) {
          parent.children.push(node)
        } else {
          // 孤立节点，视为根节点
          roots.push(node)
        }
      }
    }

    // 按 pos 排序
    const sortNodes = (nodes: TreeNode[]) => {
      nodes.sort((a, b) => a.block.pos - b.block.pos)
      for (const node of nodes) {
        sortNodes(node.children)
      }
    }
    sortNodes(roots)

    return roots
  }

  /**
   * 获取页面的 Block 树（扁平化数组形式）
   */
  async getBlockTree(pageId: string): Promise<Block[]> {
    const tree = await this.buildTree(pageId)
    const blocks: Block[] = []

    const flatten = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        blocks.push(node.block)
        flatten(node.children)
      }
    }

    flatten(tree)
    return blocks
  }

  /**
   * 获取所有 Block
   */
  async getAllBlocks(): Promise<Block[]> {
    const result = await this.repository.findAll(10000, 0)
    return result.items
  }

  /**
   * 移动 Block 到新位置
   */
  async move(blockId: string, newParentId: string | null, afterBlockId?: string): Promise<void> {
    const block = await this.repository.findById(blockId)
    if (!block) return

    // 计算新位置
    let newPos: number
    if (afterBlockId) {
      const siblings = await this.repository.findByParentId(newParentId)
      const sortedSiblings = siblings
        .filter(b => b.id !== blockId)
        .sort((a, b) => a.pos - b.pos)

      const afterIndex = sortedSiblings.findIndex(b => b.id === afterBlockId)
      if (afterIndex === -1) {
        newPos = 1000
      } else if (afterIndex === sortedSiblings.length - 1) {
        newPos = sortedSiblings[afterIndex].pos + 1000
      } else {
        newPos = Math.floor((sortedSiblings[afterIndex].pos + sortedSiblings[afterIndex + 1].pos) / 2)
      }
    } else {
      const siblings = await this.repository.findByParentId(newParentId)
      const maxPos = siblings
        .filter(b => b.id !== blockId)
        .reduce((max, b) => Math.max(max, b.pos), 0)
      newPos = maxPos === 0 ? 1000 : maxPos + 1000
    }

    // 更新 Block
    await this.repository.update(blockId, {
      parentId: newParentId,
      pos: newPos,
    })

    // 检查是否需要重排
    await this.checkAndRebalance(newParentId)
  }

  /**
   * 缩进 Block（成为前一个兄弟的子节点）
   */
  async indent(blockId: string): Promise<void> {
    const block = await this.repository.findById(blockId)
    if (!block) return

    const siblings = await this.repository.findByParentId(block.parentId)
    const index = siblings.findIndex(b => b.id === blockId)
    if (index <= 0) return

    const prevSibling = siblings[index - 1]
    await this.move(blockId, prevSibling.id, undefined)
  }

  /**
   * 反缩进 Block（成为父节点同级）
   */
  async outdent(blockId: string): Promise<void> {
    const block = await this.repository.findById(blockId)
    if (!block || !block.parentId) return

    const parent = await this.repository.findById(block.parentId)
    if (!parent) return

    await this.move(blockId, parent.parentId, parent.id)
  }

  /**
   * 检查并重新平衡位置
   *
   * 当 Gap 用尽时（差值 < 2），对该父级的所有子节点重新排序。
   */
  private async checkAndRebalance(parentId: string | null): Promise<void> {
    const siblings = await this.repository.findByParentId(parentId)
    if (siblings.length < 2) return

    // 检查是否有紧密相邻的位置
    const sorted = siblings.sort((a, b) => a.pos - b.pos)
    let needsRebalance = false

    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1].pos - sorted[i].pos
      if (gap < 2) {
        needsRebalance = true
        break
      }
    }

    if (needsRebalance) {
      const blockIds = sorted.map(b => b.id)
      await this.repository.reorder(parentId ?? null, blockIds)
    }
  }

  /**
   * 获取 Block 路径（从根到目标）
   */
  async getBlockPath(blockId: string): Promise<BlockPath | null> {
    const block = await this.repository.findById(blockId)
    if (!block) return null

    const ancestors: Block[] = []
    let current: Block | undefined = block

    while (current?.parentId) {
      const parent = await this.repository.findById(current.parentId)
      if (!parent) break
      ancestors.unshift(parent)
      current = parent
    }

    return {
      ancestors,
      current: block,
    }
  }
}
