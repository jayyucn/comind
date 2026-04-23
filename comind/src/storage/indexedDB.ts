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

  /** 重命名页面（事务：更新 pages 表 + blocks 表的 title） */
  async renamePage(pageId: string, newTitle: string): Promise<void> {
    await db.transaction('rw', [db.pages, db.blocks], async () => {
      const page = await db.pages.get(pageId)
      if (page) {
        page.title = newTitle
        page.updatedAt = Date.now()
        await db.pages.put(page)
      }
      const block = await db.blocks.get(pageId)
      if (block) {
        block.title = newTitle
        block.updatedAt = Date.now()
        await db.blocks.put(block)
      }
    })
  }

  /** 更新 Page（主要用于 updatedAt 同步） */
  async updatePage(page: PageRecord): Promise<void> {
    await db.pages.put(page)
  }

  /**
   * 合并两个页面（事务操作）
   * 将源页面的所有 Block 迁移到目标页面，重定向链接，删除源页面
   */
  async mergePage(sourceId: string, targetId: string): Promise<void> {
    await db.transaction('rw', [db.blocks, db.links, db.pages], async () => {
      // 获取源页面标题（用于文本替换）
      const sourcePage = await db.pages.get(sourceId)
      const targetPage = await db.pages.get(targetId)
      if (!sourcePage || !targetPage) return
      const sourceTitle = sourcePage.title
      const targetTitle = targetPage.title

      // 1. 获取源页面所有 Block（排除 Page Block 本身）
      const sourceBlocks = await db.blocks.where('pageId').equals(sourceId).toArray()
      const blocksToMove = sourceBlocks.filter(b => b.id !== sourceId)

      // 2. 获取目标页面顶级 Block 的最大 left 值
      const targetTopBlocks = await db.blocks
        .where('pageId').equals(targetId)
        .filter(b => b.parentId === null && b.id !== targetId)
        .toArray()
      const maxLeft = targetTopBlocks.reduce((max, b) => Math.max(max, b.left), 0)

      // 3. 源页面顶级 Block 的 left 值重算（追加到目标页面末尾）
      const sourceTopBlocks = blocksToMove.filter(b => b.parentId === null)
      const leftMap = new Map<string, number>()
      sourceTopBlocks.forEach((b, i) => {
        leftMap.set(b.id, maxLeft + (i + 1) * 100)
      })

      // 4. 迁移所有 Block：更新 pageId + 替换文本中指向源页面的链接
      for (const block of blocksToMove) {
        block.pageId = targetId
        block.content = replacePageLink(block.content, sourceTitle, targetTitle)
        block.updatedAt = Date.now()
        if (leftMap.has(block.id)) {
          block.left = leftMap.get(block.id)!
        }
        await db.blocks.put(block)
        // 重新解析并保存链接（内容已变）
        await this.saveLinks(block.id, targetId, parseBlockLinks(block.content))
      }

      // 5. 替换目标页面 Block 文本中指向源页面的链接
      //    （例如 B 引用了 A → [[A]] 要变成 [[B]]）
      const targetBlocks = await db.blocks.where('pageId').equals(targetId).toArray()
      for (const block of targetBlocks) {
        const newContent = replacePageLink(block.content, sourceTitle, targetTitle)
        if (newContent !== block.content) {
          block.content = newContent
          block.updatedAt = Date.now()
          await db.blocks.put(block)
          await this.saveLinks(block.id, targetId, parseBlockLinks(block.content))
        }
      }

      // 6. 删除所有指向源页面的链接记录（已通过 saveLinks 重新生成）
      await db.links.where('targetPageId').equals(sourceId).delete()

      // 7. 删除源 Page 记录
      await db.pages.delete(sourceId)

      // 8. 删除源 Page Block
      await db.blocks.delete(sourceId)
    })
  }
}

/**
 * 替换文本中指向源页面的 Wiki 链接
 * [[源标题]] → [[目标标题]]
 * [[源标题|别名]] → [[目标标题|别名]]
 */
function replacePageLink(content: string, sourceTitle: string, targetTitle: string): string {
  // 转义正则特殊字符
  const escaped = sourceTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // 匹配 [[源标题]] 或 [[源标题|别名]]
  const regex = new RegExp(`\\[\\[${escaped}(\\|[^\\]]+?)?\\]\\]`, 'g')
  return content.replace(regex, (_, aliasPart: string | undefined) => {
    return aliasPart ? `[[${targetTitle}${aliasPart}]]` : `[[${targetTitle}]]`
  })
}

export const storage = new IndexedDBAdapter()
