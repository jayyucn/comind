import { db } from './db'
import type { Block, BlockRecord } from '../types/block'
import type { LinkRecord } from '../types/link'
import type { Page, PageRecord } from '../types/page'
import type { Property, PropertyRecord } from '../types/property'
import { parseBlockLinks, type LinkParse } from '../utils/parser'
import { generateUUID } from '../utils/id'
import { inferPageType, normalizeJournalTitle } from '../utils/journal-detect'

function recordToBlock(record: BlockRecord): Block {
  let format: Block['format']
  let properties: Block['properties']
  try {
    format = JSON.parse(record.format)
  } catch {
    format = {}
  }
  try {
    properties = JSON.parse(record.properties)
  } catch {
    properties = {}
  }
  return {
    id: record.id,
    pageId: record.pageId,
    parentId: record.parentId,
    pos: record.pos,
    content: record.content,
    format,
    type: record.type as 'bullet' | 'property' | 'query' | 'embed',
    properties,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  }
}

function blockToRecord(block: Block): BlockRecord {
  return {
    id: block.id,
    pageId: block.pageId,
    parentId: block.parentId,
    pos: block.pos,
    content: block.content,
    format: JSON.stringify(block.format),
    type: block.type,
    properties: JSON.stringify(block.properties),
    createdAt: new Date(block.createdAt).getTime(),
    updatedAt: new Date(block.updatedAt).getTime()
  }
}

function pageToRecord(page: Page): PageRecord {
  return {
    id: page.id,
    blockId: page.blockId,
    title: page.title,
    type: page.type,
    icon: page.icon,
    cover: page.cover,
    aliases: JSON.stringify(page.aliases),
    filePath: page.filePath,
    childrenCount: page.childrenCount,
    wordCount: page.wordCount,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt
  }
}

function recordToPage(record: PageRecord): Page {
  let aliases: Page['aliases']
  try {
    aliases = JSON.parse(record.aliases)
  } catch {
    aliases = []
  }
  return {
    id: record.id,
    blockId: record.blockId,
    title: record.title,
    type: record.type as 'normal' | 'journal',
    icon: record.icon,
    cover: record.cover,
    aliases,
    filePath: record.filePath,
    childrenCount: record.childrenCount,
    wordCount: record.wordCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  }
}

function recordToProperty(record: PropertyRecord): Property {
  let value: Property['value']
  try {
    value = JSON.parse(record.value)
  } catch {
    value = ''
  }
  return {
    id: record.id,
    blockId: record.blockId,
    key: record.key,
    value,
    type: record.type as Property['type'],
    sortOrder: record.sortOrder,
    isHidden: record.isHidden === 1,
    isDeleted: record.isDeleted === 1,
    schemaVersion: record.schemaVersion,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  }
}

function propertyToRecord(property: Property): PropertyRecord {
  return {
    id: property.id,
    blockId: property.blockId,
    key: property.key,
    value: JSON.stringify(property.value),
    type: property.type,
    sortOrder: property.sortOrder,
    isHidden: property.isHidden ? 1 : 0,
    isDeleted: property.isDeleted ? 1 : 0,
    schemaVersion: property.schemaVersion,
    createdAt: property.createdAt,
    updatedAt: property.updatedAt
  }
}

export class IndexedDBAdapter {
  async saveBlock(block: Block): Promise<void> {
    await db.transaction('rw', db.links, db.blocks, db.pages, async () => {
      // 保存 Block 记录
      await db.blocks.put(blockToRecord(block))

      // 解析并保存链接
      await this.saveLinks(block.id, block.pageId, parseBlockLinks(block.content))
    })
  }

  private async saveLinks(sourceBlockId: string, _pageId: string, linkParses: LinkParse[]): Promise<void> {
    // 删除旧链接
    await db.links.where('sourceBlockId').equals(sourceBlockId).delete()

    for (const link of linkParses) {
      if (!link.isExternal) {
        // 内部链接：查找或创建目标 Page
        // 日记标题规范化：[[2026/04/26]] → 查找/创建 title="2026-04-26"
        const normalized = normalizeJournalTitle(link.targetTitle)
        const lookupTitle = normalized ?? link.targetTitle
        let targetPage = await db.pages.where('title').equals(lookupTitle).first()

        if (!targetPage) {
          const pageType = normalized ? 'journal' : inferPageType(link.targetTitle)
          const newPage = await this.createPageWithRootBlock(lookupTitle, pageType)
          targetPage = pageToRecord(newPage)
          await db.pages.put(targetPage)
        }
        await db.links.add({
          id: generateUUID(),
          sourceBlockId,
          targetPageId: targetPage.id,
          displayText: link.displayText,
          createdAt: Date.now()
        })
      }
    }
  }

  async getBlockTree(pageId: string): Promise<Block[]> {
    const allRecords = await db.blocks.where('pageId').equals(pageId).toArray()
    const blocks = allRecords.map(recordToBlock)

    // 按 parentId 分组
    const byParent = new Map<string | null, Block[]>()
    for (const block of blocks) {
      const parentId: string | null = block.parentId
      if (!byParent.has(parentId)) byParent.set(parentId, [])
      byParent.get(parentId)!.push(block)
    }

    // 每组按 pos 排序（Gap 排序）
    for (const children of byParent.values()) {
      children.sort((a, b) => a.pos - b.pos)
    }

    // DFS 展平: parentId=null 在前，然后递归 children
    const result: Block[] = []
    const dfs = (parentId: string | null) => {
      const children = byParent.get(parentId) ?? []
      for (const child of children) {
        result.push(child)
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
    await db.transaction('rw', db.blocks, db.links, db.properties, async () => {
      await db.blocks.delete(blockId)
      await db.links.where('sourceBlockId').equals(blockId).delete()
      await this.deletePropertiesByBlockId(blockId)
    })
  }

  /** 级联删除多个 Block 及其所有 Links 和 Properties */
  async deleteBlockCascade(blockIds: string[]): Promise<void> {
    await db.transaction('rw', [db.blocks, db.links, db.properties], async () => {
      // 批量删除 Blocks
      await db.blocks.bulkDelete(blockIds)
      // 批量删除所有相关 Links（sourceBlockId 在列表中的记录）
      await db.links.where('sourceBlockId').anyOf(blockIds).delete()
      // 批量删除所有相关 Properties
      for (const blockId of blockIds) {
        await this.deletePropertiesByBlockId(blockId)
      }
    })
  }

  async getPage(title: string): Promise<Page | undefined> {
    const record = await db.pages.where('title').equals(title).first()
    return record ? recordToPage(record) : undefined
  }

  /**
   * 创建 Page（仅创建 Page 记录，不创建关联的根 Block）
   *
   * 注意：此方法目前未被调用。正常页面创建应使用 createPageWithRootBlock，
   * 确保页面创建后立即有一个可编辑的空 Block。
   *
   * 保留此方法用于以下场景：
   * - 批量数据迁移：先批量创建页面占位，后续异步填充 Block
   * - 模板系统：模板实例化时页面已包含预定义 Block
   * - 外部数据同步：先创建页面占位，Block 内容由后续同步拉取
   */
  async createPage(title: string, type: 'normal' | 'journal' = 'normal'): Promise<Page> {
    const now = Date.now()
    const page: Page = {
      id: generateUUID(),
      blockId: null,
      title,
      type,
      icon: null,
      cover: null,
      aliases: [],
      filePath: null,
      childrenCount: 0,
      wordCount: 0,
      createdAt: now,
      updatedAt: now
    }
    await db.pages.put(pageToRecord(page))
    return page
  }

  async getAllPages(): Promise<Page[]> {
    const records = await db.pages.orderBy('title').toArray()
    return records.map(recordToPage)
  }

  async getById(id: string): Promise<Page | undefined> {
    const record = await db.pages.get(id)
    return record ? recordToPage(record) : undefined
  }

  async getPagesByType(type: 'normal' | 'journal'): Promise<Page[]> {
    const records = await db.pages.where('type').equals(type).sortBy('title')
    return records.map(recordToPage)
  }

  async getBacklinks(pageId: string): Promise<LinkRecord[]> {
    return db.links.where('targetPageId').equals(pageId).toArray()
  }

  /** 重命名页面 */
  async renamePage(pageId: string, newTitle: string): Promise<void> {
    await db.transaction('rw', [db.pages], async () => {
      const record = await db.pages.get(pageId)
      if (record) {
        const page = recordToPage(record)
        page.title = newTitle
        page.updatedAt = Date.now()
        await db.pages.put(pageToRecord(page))
      }
    })
  }

  /** 更新 Page */
  async updatePage(page: Page): Promise<void> {
    await db.pages.put(pageToRecord(page))
  }

  /**
   * 合并两个页面（事务操作）
   * 将源页面的所有 Block 迁移到目标页面，重定向链接，删除源页面
   */
  async mergePage(sourceId: string, targetId: string): Promise<void> {
    await db.transaction('rw', [db.blocks, db.links, db.pages], async () => {
      // 获取源页面标题（用于文本替换）
      const sourceRecord = await db.pages.get(sourceId)
      const targetRecord = await db.pages.get(targetId)
      if (!sourceRecord || !targetRecord) return
      const sourcePage = recordToPage(sourceRecord)
      const targetPage = recordToPage(targetRecord)
      const sourceTitle = sourcePage.title
      const targetTitle = targetPage.title

      // 1. 获取源页面所有 Block
      const sourceBlocks = await db.blocks.where('pageId').equals(sourceId).toArray()
      const blocksToMove = sourceBlocks.map(recordToBlock)

      // 2. 迁移所有 Block：更新 pageId + 替换文本中指向源页面的链接
      for (const block of blocksToMove) {
        block.pageId = targetId
        block.content = replacePageLink(block.content, sourceTitle, targetTitle)
        block.updatedAt = Date.now()
        await db.blocks.put(blockToRecord(block))
        // 重新解析并保存链接（内容已变）
        await this.saveLinks(block.id, targetId, parseBlockLinks(block.content))
      }

      // 3. 替换目标页面 Block 文本中指向源页面的链接
      const targetBlocks = await db.blocks.where('pageId').equals(targetId).toArray()
      for (const record of targetBlocks) {
        const block = recordToBlock(record)
        const newContent = replacePageLink(block.content, sourceTitle, targetTitle)
        if (newContent !== block.content) {
          block.content = newContent
          block.updatedAt = Date.now()
          await db.blocks.put(blockToRecord(block))
          await this.saveLinks(block.id, targetId, parseBlockLinks(block.content))
        }
      }

      // 4. 删除所有指向源页面的链接记录（已通过 saveLinks 重新生成）
      await db.links.where('targetPageId').equals(sourceId).delete()

      // 5. 删除源 Page 记录
      await db.pages.delete(sourceId)
    })
  }

  /**
   * 创建页面并关联根 Block
   */
  async createPageWithRootBlock(title: string, type: 'normal' | 'journal' = 'normal'): Promise<Page> {
    const now = Date.now()

    // 1. 创建根 Block
    const rootBlock: Block = {
      id: generateUUID(),
      pageId: '', // 先空，后续更新
      parentId: null,
      pos: 1000,
      content: '',
      format: {},
      type: 'bullet',
      properties: {},
      createdAt: now,
      updatedAt: now
    }

    // 2. 创建 Page
    const page: Page = {
      id: generateUUID(),
      blockId: rootBlock.id,
      title,
      type,
      icon: null,
      cover: null,
      aliases: [],
      filePath: null,
      childrenCount: 0,
      wordCount: 0,
      createdAt: now,
      updatedAt: now
    }

    // 3. 更新 Block 的 pageId
    rootBlock.pageId = page.id

    // 4. 事务保存
    await db.transaction('rw', [db.pages, db.blocks], async () => {
      await db.pages.put(pageToRecord(page))
      await db.blocks.put(blockToRecord(rootBlock))
    })

    return page
  }

  /**
   * 删除页面（级联删除所有相关 Block 和 Link）
   */
  async deletePage(pageId: string): Promise<void> {
    await db.transaction('rw', [db.pages, db.blocks, db.links], async () => {
      // 1. 获取页面所有 Block
      const blocks = await db.blocks.where('pageId').equals(pageId).toArray()
      const blockIds = blocks.map(b => b.id)

      // 2. 删除所有相关 Link
      // 源 Block 在该页面内的链接
      await db.links.where('sourceBlockId').anyOf(blockIds).delete()
      // 目标指向该页面的链接
      await db.links.where('targetPageId').equals(pageId).delete()

      // 3. 删除所有 Block
      await db.blocks.bulkDelete(blockIds)

      // 4. 删除 Page
      await db.pages.delete(pageId)
    })
  }

  /**
   * 同步页面统计信息
   */
  async syncPageStats(pageId: string): Promise<void> {
    const blocks = await this.getBlockTree(pageId)
    const count = blocks.length
    const words = blocks.reduce((sum, b) => sum + b.content.split(/\s+/).length, 0)

    const record = await db.pages.get(pageId)
    if (record) {
      const page = recordToPage(record)
      page.childrenCount = count
      page.wordCount = words
      page.updatedAt = Date.now()
      await db.pages.put(pageToRecord(page))
    }
  }

  // === Property 相关方法 ===

  async saveProperty(property: Property): Promise<void> {
    await db.properties.put(propertyToRecord(property))
  }

  async getPropertyById(id: string): Promise<Property | undefined> {
    const record = await db.properties.get(id)
    if (record && !record.isDeleted) {
      return recordToProperty(record)
    }
    return undefined
  }

  async getProperties(blockId: string): Promise<Property[]> {
    const records = await db.properties
      .where('blockId').equals(blockId)
      .filter(p => !p.isDeleted)
      .sortBy('sortOrder')
    return records.map(recordToProperty)
  }

  async getProperty(blockId: string, key: string): Promise<Property | undefined> {
    const record = await db.properties.get([blockId, key])
    if (record && !record.isDeleted) {
      return recordToProperty(record)
    }
    return undefined
  }

  async deleteProperty(id: string): Promise<void> {
    const record = await db.properties.get(id)
    if (record) {
      record.isDeleted = 1
      record.updatedAt = Date.now()
      await db.properties.put(record)
    }
  }

  async hardDeleteProperty(id: string): Promise<void> {
    await db.properties.delete(id)
  }

  async deletePropertiesByBlockId(blockId: string): Promise<void> {
    const records = await db.properties.where('blockId').equals(blockId).toArray()
    const ids = records.map(r => r.id)
    await db.properties.bulkDelete(ids)
  }

  async getPropertiesByBlockIds(blockIds: string[]): Promise<Map<string, Property[]>> {
    const records = await db.properties
      .where('blockId').anyOf(blockIds)
      .filter(p => !p.isDeleted)
      .toArray()

    const result = new Map<string, Property[]>()
    for (const record of records) {
      const list = result.get(record.blockId) ?? []
      list.push(recordToProperty(record))
      result.set(record.blockId, list)
    }
    return result
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
