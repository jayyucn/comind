import { db } from './db'
import type { Block, BlockRecord } from '../types/block'
import type { LinkRecord, PageRecord } from '../types/link'
import { parseBlockLinks, type LinkParse } from '../utils/parser'
import { generateUUID } from '../utils/id'

function recordToBlock(record: BlockRecord): Block {
  return {
    id: record.id,
    content: record.content,
    parentId: record.parentId,
    pageId: record.pageId,
    left: record.left,
    createdAt: new Date(record.createdAt).toISOString(),
    updatedAt: new Date(record.updatedAt).toISOString(),
    isPage: record.isPage,
    title: record.title,
    properties: record.properties ? JSON.parse(record.properties) : undefined,
    collapsed: record.collapsed
  }
}

export class IndexedDBAdapter {
  async saveBlock(block: Block): Promise<void> {
    await db.transaction('rw', db.links, db.pages, db.blocks, async () => {
      // 保存 Block 记录
      await db.blocks.put({
        id: block.id,
        content: block.content,
        parentId: block.parentId,
        pageId: block.pageId,
        left: block.left,
        createdAt: new Date(block.createdAt).getTime(),
        updatedAt: Date.now(),
        isPage: block.isPage,
        title: block.title,
        properties: block.properties ? JSON.stringify(block.properties) : undefined,
        collapsed: block.collapsed
      })

      // 解析并保存链接
      await this.saveLinks(block.id, block.pageId, parseBlockLinks(block.content))
    })
  }

  private async saveLinks(sourceBlockId: string, _pageId: string, linkParses: LinkParse[]): Promise<void> {
    // 删除旧链接
    await db.links.where('sourceBlockId').equals(sourceBlockId).delete()

    for (const link of linkParses) {
      let targetPageId: string | null = null

      if (!link.isExternal) {
        // 内部链接：查找或创建目标 Page
        let targetPage = await db.pages.where('title').equals(link.targetTitle).first()

        if (!targetPage) {
          const pageId = generateUUID()
          targetPage = {
            id: pageId,
            title: link.targetTitle,
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
          await db.pages.put(targetPage)
        }
        targetPageId = targetPage.id
      }

      await db.links.add({
        sourceBlockId,
        targetPageId,
        displayText: link.displayText,
        position: link.position,
        linkType: link.isExternal ? 'external' : 'internal',
        createdAt: Date.now()
      })
    }
  }

  async getBlockTree(pageId: string): Promise<Block[]> {
    // 按 parentId 分组，每组内按 left 排序，最后 DFS 展平
    const allRecords = await db.blocks.where('pageId').equals(pageId).toArray()
    const blocks = allRecords.map(recordToBlock)

    // 按 parentId 分组
    const byParent = new Map<string | null, Block[]>()
    for (const block of blocks) {
      const parentId: string | null = block.parentId
      if (!byParent.has(parentId)) byParent.set(parentId, [])
      byParent.get(parentId)!.push(block)
    }

    // 每组按 left 排序
    for (const children of byParent.values()) {
      children.sort((a, b) => a.left - b.left)
    }

    // DFS 展平: parentId=null 在前，然后递归 children
    const result: Block[] = []
    const dfs = (parentId: string | null) => {
      const children = byParent.get(parentId) ?? []
      for (const child of children) {
        result.push(child)
        // 递归 children（只处理 parentId 指向真实存在的 block，避免孤儿节点）
        dfs(child.id)
      }
    }

    dfs(null)
    return result
  }

  async getAllBlocks(): Promise<Block[]> {
    const records = await db.blocks.toArray()
    return records.map(recordToBlock)
  }

  async deleteBlock(blockId: string): Promise<void> {
    await db.transaction('rw', db.blocks, db.links, async () => {
      await db.blocks.delete(blockId)
      await db.links.where('sourceBlockId').equals(blockId).delete()
    })
  }

  /** 级联删除多个 Block 及其所有 Links */
  async deleteBlockCascade(blockIds: string[]): Promise<void> {
    await db.transaction('rw', db.blocks, db.links, async () => {
      // 批量删除 Blocks
      await db.blocks.bulkDelete(blockIds)
      // 批量删除所有相关 Links（sourceBlockId 在列表中的记录）
      await db.links.where('sourceBlockId').anyOf(blockIds).delete()
    })
  }

  async getPage(title: string): Promise<PageRecord | undefined> {
    return db.pages.where('title').equals(title).first()
  }

  async createPage(title: string): Promise<PageRecord> {
    const page: PageRecord = {
      id: generateUUID(),
      title,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    await db.pages.put(page)
    return page
  }

  async getAllPages(): Promise<PageRecord[]> {
    return db.pages.orderBy('title').toArray()
  }

  async getBacklinks(pageId: string): Promise<LinkRecord[]> {
    return db.links.where('targetPageId').equals(pageId).toArray()
  }
}

export const storage = new IndexedDBAdapter()
