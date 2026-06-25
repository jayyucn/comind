import { db } from './db'
import type { Block, BlockRecord } from '../types/block'
import type { LinkRecord } from '../types/link'
import type { Page, PageRecord } from '../types/page'
import type { Property, PropertyRecord } from '../types/property'
import { getPredefinedRelationship } from '../types/relationship'
import { parseBlockLinks, type LinkParse } from '../utils/parser'
import { generateUUID } from '../utils/id'
import { normalizeJournalTitle } from '../utils/journal-detect'

export function recordToBlock(record: BlockRecord): Block {
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
    type: record.type as 'bullet' | 'property' | 'query' | 'embed' | 'code' | 'image',
    properties,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  }
}

export function blockToRecord(block: Block): BlockRecord {
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

export function pageToRecord(page: Page): PageRecord {
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
    updatedAt: page.updatedAt,
    deleted: page.deleted ? 1 : 0,
    deletedAt: page.deletedAt
  }
}

export function recordToPage(record: PageRecord): Page {
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
    updatedAt: record.updatedAt,
    deleted: record.deleted === 1,
    deletedAt: record.deletedAt ?? null
  }
}

export function recordToProperty(record: PropertyRecord): Property {
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

export function propertyToRecord(property: Property): PropertyRecord {
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
  async saveBlock(block: Block): Promise<{ skippedTrashedPages?: string[] }> {
    const skippedTrashedPages: string[] = []

    await db.transaction('rw', db.links, db.blocks, db.pages, async () => {
      // 保存 Block 记录
      await db.blocks.put(blockToRecord(block))

      // 解析并保存链接
      const result = await this.saveLinks(block.id, block.pageId, parseBlockLinks(block.content))
      skippedTrashedPages.push(...result.skippedTrashedPages)
    })

    return skippedTrashedPages.length > 0 ? { skippedTrashedPages } : {}
  }

  private async saveLinks(sourceBlockId: string, pageId: string, linkParses: LinkParse[], skipInverseCreation = false): Promise<{ skippedTrashedPages: string[] }> {
    const skippedTrashedPages: string[] = []

    await db.links.where('sourceBlockId').equals(sourceBlockId).delete()

    for (const link of linkParses) {
      if (!link.isExternal) {
        const normalized = normalizeJournalTitle(link.targetTitle)
        const lookupTitle = normalized ?? link.targetTitle
        const existingPage = await db.pages.where('title').equals(lookupTitle).first()

        if (existingPage && existingPage.deleted === 1) {
          skippedTrashedPages.push(lookupTitle)
          continue
        }

        if (existingPage) {
          const linkRecord: Omit<LinkRecord, 'id' | 'createdAt'> = {
            sourceBlockId,
            targetPageId: existingPage.id,
            displayText: link.displayText,
            relationshipType: link.relationshipType,
            inverseRelationshipType: link.inverseRelationshipType
          }
          await db.links.add({
            id: generateUUID(),
            ...linkRecord,
            createdAt: Date.now()
          })

          // 如果有双向关系，创建反向链接（自动生成的反向链接不再递归创建）
          if (link.relationshipType && !skipInverseCreation) {
            await this.createInverseLink(pageId, link.targetTitle, link.relationshipType, link.inverseRelationshipType)
          }
        }
      }
    }

    return { skippedTrashedPages }
  }

  /** 创建反向关系链接 */
  private async createInverseLink(
    sourcePageId: string,
    targetPageTitle: string,
    relationshipType: string,
    inverseRelationshipType: string | null
  ): Promise<void> {
    const targetPage = await db.pages.where('title').equals(targetPageTitle).first()
    if (!targetPage) return

    // 防止自引用产生无意义的反向链接（例如 [[E]]^(required-by) 在 E 自身页面）
    if (sourcePageId === targetPage.id) return

    // 如果没有提供反向关系类型，从预定义类型中查找
    let actualInverseType = inverseRelationshipType
    if (!actualInverseType) {
      const predefined = getPredefinedRelationship(relationshipType)
      if (predefined?.inverse) {
        actualInverseType = predefined.inverse
      }
    }

    if (!actualInverseType) return

    // 在目标页面创建或更新反向关系
    await this.createRootBlockWithLink(
      targetPage.id,
      sourcePageId,
      actualInverseType
    )
  }

  /** 在目标页查找或创建独立的反向链接 block（不修改页面根块） */
  private async createRootBlockWithLink(
    pageId: string,
    targetPageId: string,
    relationshipType: string
  ): Promise<void> {
    // 获取页面信息
    const sourcePage = await db.pages.get(targetPageId) // 原始链接的源页面（反向链接要指向的页面）
    if (!sourcePage) return

    const targetPage = await db.pages.get(pageId) // 要在这个页面创建反向链接
    if (!targetPage) return

    const linkText = `((${relationshipType}))[[${sourcePage.title}]]`
    const escapedTitle = sourcePage.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // 匹配单行：((type))[[title]] 或 ((type))[[title|alias]]，可有前导的 "- " 或空白
    const linePattern = new RegExp(
      `^\\s*-?\\s*\\(\\([^)]+\\)\\)\\[\\[${escapedTitle}(?:\\|[^\\]]+)?\\]\\]\\s*$`
    )

    // 在目标页所有 block 中查找是否已有指向源页（任意类型）的反向链接
    const allBlocks = await db.blocks.where('pageId').equals(pageId).toArray()
    const existingBlock = allBlocks.find(b =>
      b.content.split('\n').some(line => linePattern.test(line))
    )

    const now = Date.now()

    if (existingBlock) {
      // 已有指向同一源页的 block，更新其内容（不会修改页面的根块或其他用户 block）
      if (existingBlock.content.includes(linkText)) return

      const newContent = existingBlock.content
        .split('\n')
        .map(line => linePattern.test(line) ? linkText : line)
        .join('\n')

      await db.blocks.update(existingBlock.id, {
        content: newContent,
        updatedAt: now
      })
      await this.saveLinks(existingBlock.id, pageId, parseBlockLinks(newContent), true)
    } else {
      // 新建独立的 top-level block 承载反向链接（parentId 指向页面根 Block）
      const newBlockId = generateUUID()
      const newBlock: Block = {
        id: newBlockId,
        pageId,
        parentId: targetPage.blockId, // 指向页面根 Block
        pos: 1000,
        content: linkText,
        format: {},
        type: 'bullet',
        properties: {},
        createdAt: now,
        updatedAt: now
      }
      await db.blocks.put(blockToRecord(newBlock))
      await this.saveLinks(newBlockId, pageId, parseBlockLinks(linkText), true)
    }
  }

  /** 同步同一页面内的多链接关系类型 */
  async updateLinksWithRelationshipType(pageId: string, sourceBlockId: string, targetPageId: string, relationshipType: string | null): Promise<void> {
    const pageBlocks = await db.blocks.where('pageId').equals(pageId).toArray()
    const blockIds = pageBlocks.map(b => b.id)

    // 查找所有指向同一目标页面的链接
    const links = await db.links
      .where('sourceBlockId').anyOf(blockIds)
      .and(l => l.targetPageId === targetPageId)
      .toArray()

    for (const link of links) {
      if (link.id !== (await db.links.where('sourceBlockId').equals(sourceBlockId).first())?.id) {
        await db.links.update(link.id, { relationshipType })
      }
    }
  }

  /** 根据关系类型获取链接 */
  async getLinksByRelationshipType(pageId: string, relationshipType?: string): Promise<LinkRecord[]> {
    if (relationshipType) {
      // 获取所有指向该页面或从该页面出发的链接
      const outboundLinks = await db.links
        .where('sourceBlockId').anyOf(
          (await db.blocks.where('pageId').equals(pageId).toArray()).map(b => b.id)
        )
        .and(l => l.relationshipType === relationshipType)
        .toArray()
      
      const inboundLinks = await db.links
        .where('targetPageId').equals(pageId)
        .and(l => l.inverseRelationshipType === relationshipType || l.relationshipType === relationshipType)
        .toArray()
      
      return [...outboundLinks, ...inboundLinks]
    }
    // 如果没有指定类型，返回所有带关系类型的链接
    const allBlockIds = (await db.blocks.where('pageId').equals(pageId).toArray()).map(b => b.id)
    return db.links
      .where('sourceBlockId').anyOf(allBlockIds)
      .and(l => l.relationshipType !== null)
      .toArray()
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

  async getAllPages(): Promise<Page[]> {
    const records = await db.pages.orderBy('title').toArray()
    return records
      .filter(r => r.deleted !== 1)
      .map(recordToPage)
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

  async getLinksBySourcePage(pageId: string): Promise<LinkRecord[]> {
    const blockIds = (await db.blocks.where('pageId').equals(pageId).toArray()).map(b => b.id)
    return db.links.where('sourceBlockId').anyOf(blockIds).toArray()
  }

  async getLinksByTargetPage(pageId: string): Promise<LinkRecord[]> {
    return db.links.where('targetPageId').equals(pageId).toArray()
  }

  /** 检查回收站中是否有指定标题的页面 */
  async getTrashedPageByTitle(title: string): Promise<Page | undefined> {
    const record = await db.pages
      .where('title').equals(title)
      .and(r => r.deleted === 1)
      .first()
    return record ? recordToPage(record) : undefined
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
   *
   * 根 Block 的 content 为页面标题，parentId 为 null。
   * 页面下可见的一级 block 的 parentId 指向根 Block。
   */
  async createPageWithRootBlock(title: string, type: 'normal' | 'journal' = 'normal'): Promise<Page> {
    const now = Date.now()

    // 1. 创建根 Block（content 为页面标题，不渲染为可见 block）
    const rootBlock: Block = {
      id: generateUUID(),
      pageId: '', // 先空，后续更新
      parentId: null,
      pos: 0,
      content: title,
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
      updatedAt: now,
      deleted: false,
      deletedAt: null
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

  /** 软删除页面（移至回收站） */
  async softDeletePage(pageId: string): Promise<void> {
    await this.cleanupPageReferences(pageId)
    await db.transaction('rw', [db.pages], async () => {
      const record = await db.pages.get(pageId)
      if (record) {
        const page = recordToPage(record)
        page.deleted = true
        page.deletedAt = Date.now()
        page.updatedAt = Date.now()
        await db.pages.put(pageToRecord(page))
      }
    })
  }

  /** 恢复页面（从回收站还原） */
  async restorePage(pageId: string): Promise<void> {
    await db.transaction('rw', [db.pages], async () => {
      const record = await db.pages.get(pageId)
      if (record) {
        const page = recordToPage(record)
        page.deleted = false
        page.deletedAt = null
        page.updatedAt = Date.now()
        await db.pages.put(pageToRecord(page))
      }
    })
  }

  /** 物理删除页面（从回收站永久删除） */
  async permanentDeletePage(pageId: string): Promise<void> {
    // 先清理其他页面对该页面的 [[]] 引用
    await this.cleanupPageReferences(pageId)

    await db.transaction('rw', [db.pages, db.blocks, db.links], async () => {
      // 1. 获取页面所有 Block
      const blocks = await db.blocks.where('pageId').equals(pageId).toArray()
      const blockIds = blocks.map(b => b.id)

      // 2. 删除所有相关 Link
      await db.links.where('sourceBlockId').anyOf(blockIds).delete()
      await db.links.where('targetPageId').equals(pageId).delete()

      // 3. 删除所有 Block
      await db.blocks.bulkDelete(blockIds)

      // 4. 删除 Page
      await db.pages.delete(pageId)
    })
  }

  /** 清理所有对指定页面的 [[]] 引用 */
  async cleanupPageReferences(pageId: string): Promise<void> {
    const pageRecord = await db.pages.get(pageId)
    if (!pageRecord) return

    const pageTitle = pageRecord.title
    const escapedTitle = pageTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const linkPattern = new RegExp(`\\[\\[${escapedTitle}(?:\\|[^\\]]+)?\\]\\]`, 'g')

    const allBlocks = await db.blocks.toArray()
    const blocksWithRefs = allBlocks.filter(b => linkPattern.test(b.content))

    if (blocksWithRefs.length === 0) return

    await db.transaction('rw', db.blocks, db.links, async () => {
      for (const block of blocksWithRefs) {
        const originalContent = block.content
        const cleanedContent = originalContent.replace(linkPattern, pageTitle)

        if (cleanedContent !== originalContent) {
          await db.blocks.update(block.id, {
            content: cleanedContent,
            updatedAt: Date.now()
          })

          const oldLinks = await db.links.where('sourceBlockId').equals(block.id).toArray()
          const pageTitleForLink = pageTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const linkRegex = new RegExp(`\\[\\[${pageTitleForLink}(?:\\|[^\\]]+)?\\]\\]`)

          for (const link of oldLinks) {
            if (linkRegex.test(link.displayText) || linkRegex.test(`[[${link.displayText}]]`)) {
              await db.links.delete(link.id)
            }
          }
        }
      }
    })
  }

  /** 获取回收站中的页面 */
  async getTrashedPages(): Promise<Page[]> {
    const records = await db.pages.where('deleted').equals(1).sortBy('deletedAt')
    return records.map(recordToPage).reverse()
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
    const records = await db.properties
      .where('[blockId+key]').equals([blockId, key])
      .toArray()
    
    const record = records.find(r => !r.isDeleted)
    if (record) {
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
