import { db } from './db'
import type { Block, BlockRecord } from '../types/block'
import type { LinkRecord, GraphNode, GraphEdge, ConceptGraphData } from '../types/link'
import type { Page, PageRecord } from '../types/page'
import type { Property, PropertyRecord } from '../types/property'
import { parseBlockLinks, type LinkParse, getRelationshipConfig, PREDEFINED_RELATIONSHIPS } from '../utils/parser'
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
      await db.blocks.put(blockToRecord(block))
      const result = await this.saveLinks(block.id, block.pageId, parseBlockLinks(block.content))
      skippedTrashedPages.push(...result.skippedTrashedPages)
      await this.inferInverseRelationships(block.id, block.pageId)
    })

    return skippedTrashedPages.length > 0 ? { skippedTrashedPages } : {}
  }

  private async inferInverseRelationships(sourceBlockId: string, sourcePageId: string): Promise<void> {
    const sourceLinks = await db.links.where('sourceBlockId').equals(sourceBlockId).toArray()
    const sourcePageRecord = await db.pages.get(sourcePageId)
    if (!sourcePageRecord) return

    for (const sourceLink of sourceLinks) {
      if (sourceLink.relationshipType) continue
      const targetPageId = sourceLink.targetPageId
      if (targetPageId === sourcePageId) continue

      const allLinks = await db.links.toArray()
      for (const link of allLinks) {
        if (link.targetPageId === sourcePageId && link.relationshipType) {
          const inverseType = this.getInverseRelationshipType(link.relationshipType)
          if (inverseType) {
            link.inverseRelationshipType = inverseType
            await db.links.put(link)
            sourceLink.relationshipType = link.relationshipType
            sourceLink.inverseRelationshipType = inverseType
            await db.links.put(sourceLink)
            break
          }
        }
      }
    }
  }

  private getInverseRelationshipType(relationshipType: string): string | null {
    const predefined = PREDEFINED_RELATIONSHIPS.find(r => r.key === relationshipType)
    return predefined?.inverseKey ?? null
  }

  private async saveLinks(sourceBlockId: string, sourcePageId: string, linkParses: LinkParse[]): Promise<{ skippedTrashedPages: string[] }> {
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
          const newLink = {
            id: generateUUID(),
            sourceBlockId,
            targetPageId: existingPage.id,
            displayText: link.displayText,
            createdAt: Date.now(),
            relationshipType: link.relationshipType ?? null,
            inverseRelationshipType: link.inverseRelationshipType ?? null,
          }
          await db.links.add(newLink)

          // 如果有反向关系，创建反向链接
          if (link.inverseRelationshipType) {
            await this.createInverseLink(
              sourceBlockId,
              sourcePageId,
              existingPage.id,
              link.targetTitle,
              link.inverseRelationshipType
            )
          }
        }
      }
    }

    return { skippedTrashedPages }
  }

  /**
   * 创建反向链接
   */
  private async createInverseLink(
    _sourceBlockId: string,
    sourcePageId: string,
    targetPageId: string,
    _targetPageTitle: string,
    inverseRelationshipType: string
  ): Promise<void> {
    const sourcePage = await db.pages.get(sourcePageId)
    if (!sourcePage) return

    const targetBlocks = await db.blocks.where('pageId').equals(targetPageId).toArray()

    let found = false

    for (const block of targetBlocks) {
      const links = await this.parseBlockLinksFromContent(block.content)
      const hasLinkToSource = links.some(l => l.targetTitle === sourcePage.title)

      if (hasLinkToSource) {
        await this.updateLinksWithRelationshipType(block.id, sourcePage.title, inverseRelationshipType)
        const updatedBlock = await db.blocks.get(block.id)
        if (updatedBlock && updatedBlock.content !== block.content) {
          const newLinkParses = await this.parseBlockLinksFromContent(updatedBlock.content)
          await this.saveLinksWithoutInverse(block.id, targetPageId, newLinkParses)
        }

        found = true
        break
      }
    }

    if (found) return

    // 未找到现有链接，插入到最后一个一级 Block
    const topLevelBlocks = targetBlocks.filter(b =>
      b.parentId === null
    ).sort((a, b) => a.pos - b.pos)

    if (topLevelBlocks.length > 0) {
      // 追加到最后一个一级 Block
      const lastBlock = topLevelBlocks[topLevelBlocks.length - 1]
      const inverseLinkText = `[[${sourcePage.title}]]^(${inverseRelationshipType})`
      const separator = lastBlock.content.trim() ? ' ' : ''

      await db.blocks.update(lastBlock.id, {
        content: lastBlock.content + separator + inverseLinkText,
        updatedAt: Date.now()
      })
    } else {
      // 目标页面没有内容，创建根 Block
      const rootBlock = await this.createRootBlockWithLink(
        targetPageId,
        sourcePage.title,
        inverseRelationshipType
      )

      // 更新页面的 blockId
      await db.pages.update(targetPageId, { blockId: rootBlock.id })
    }
  }

  /**
   * 从内容解析链接但不触发反向链接创建
   */
  private async parseBlockLinksFromContent(content: string): Promise<LinkParse[]> {
    // 复用 parseBlockLinks，但这里需要动态导入
    // 由于依赖循环问题，直接调用工具函数
    const { parseBlockLinks: parseFn } = await import('../utils/parser')
    return parseFn(content)
  }

  /**
   * 保存链接但不触发反向链接创建
   */
  private async saveLinksWithoutInverse(sourceBlockId: string, _sourcePageId: string, linkParses: LinkParse[]): Promise<void> {
    await db.links.where('sourceBlockId').equals(sourceBlockId).delete()

    for (const link of linkParses) {
      if (!link.isExternal) {
        const normalized = normalizeJournalTitle(link.targetTitle)
        const lookupTitle = normalized ?? link.targetTitle
        const existingPage = await db.pages.where('title').equals(lookupTitle).first()

        if (existingPage && existingPage.deleted !== 1) {
          await db.links.add({
            id: generateUUID(),
            sourceBlockId,
            targetPageId: existingPage.id,
            displayText: link.displayText,
            createdAt: Date.now(),
            relationshipType: link.relationshipType ?? null,
            inverseRelationshipType: null // 不触发反向链接创建
          })
        }
      }
    }
  }

  /**
   * 更新 Block 内容中指向特定页面的链接，追加关系类型
   */
  async updateLinksWithRelationshipType(
    blockId: string,
    targetPageTitle: string,
    relationshipType: string | null
  ): Promise<void> {
    const block = await db.blocks.get(blockId)
    if (!block) return

    let updatedContent: string
    if (relationshipType === null) {
      // 移除关系类型
      updatedContent = this.removeLinksRelationshipType(block.content, targetPageTitle)
    } else {
      // 添加或更新关系类型
      updatedContent = this.addLinksRelationshipType(block.content, targetPageTitle, relationshipType)
    }

    if (updatedContent !== block.content) {
      await db.blocks.update(block.id, {
        content: updatedContent,
        updatedAt: Date.now()
      })
    }
  }

  private addLinksRelationshipType(
    content: string,
    targetPageTitle: string,
    relationshipType: string
  ): string {
    const escapedTitle = targetPageTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const linkRegex = new RegExp(
      `\\[\\[${escapedTitle}(?:\\|[^\\]]+?)?\\]\\](?:\\^\\([^)]+?\\))?`,
      'g'
    )

    return content.replace(linkRegex, (match) => {
      const baseMatch = match.match(/^\[\[[^\]]+?\]\]/)
      if (!baseMatch) return match
      return `${baseMatch[0]}^(${relationshipType})`
    })
  }

  private removeLinksRelationshipType(
    content: string,
    targetPageTitle: string
  ): string {
    const escapedTitle = targetPageTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const linkRegex = new RegExp(
      `\\[\\[${escapedTitle}(?:\\|[^\\]]+?)?\\]\\]\\^\\([^)]+?\\)`,
      'g'
    )

    return content.replace(linkRegex, (match) => {
      const baseMatch = match.match(/^\[\[[^\]]+?\]\]/)
      if (!baseMatch) return match
      return baseMatch[0]
    })
  }

  /**
   * 创建包含链接的根 Block
   */
  private async createRootBlockWithLink(
    pageId: string,
    targetTitle: string,
    relationshipType: string
  ): Promise<BlockRecord> {
    const now = Date.now()
    const rootBlock: Block = {
      id: generateUUID(),
      pageId,
      parentId: null,
      pos: 1000,
      content: `[[${targetTitle}]]^(${relationshipType})`,
      format: {},
      type: 'bullet',
      properties: {},
      createdAt: now,
      updatedAt: now
    }

    const record = blockToRecord(rootBlock)
    await db.blocks.put(record)
    return record
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
      updatedAt: now,
      deleted: false,
      deletedAt: null
    }
    await db.pages.put(pageToRecord(page))
    return page
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

  /**
   * 获取概念图谱数据（支持多深度）
   */
  async getConceptGraph(startPageId: string, maxDepth: number = 2): Promise<ConceptGraphData> {
    const nodesMap = new Map<string, GraphNode>()
    const edgesMap = new Map<string, GraphEdge>()
    const processedPages = new Set<string>()

    // 队列：{ pageId, depth }
    const queue: Array<{ pageId: string; depth: number }> = [{ pageId: startPageId, depth: 0 }]

    while (queue.length > 0) {
      const { pageId, depth } = queue.shift()!
      if (processedPages.has(pageId) || depth > maxDepth) continue
      processedPages.add(pageId)

      // 添加当前页面节点
      const page = await db.pages.get(pageId)
      if (!page) continue
      const isStart = pageId === startPageId
      nodesMap.set(pageId, {
        id: pageId,
        title: page.title,
        isCurrentPage: isStart
      })

      if (depth < maxDepth) {
        // 获取所有链接（正向、反向）
        const allLinks = await db.links.toArray()

        for (const link of allLinks) {
          // 先获取源块所在页面
          const sourceBlock = await db.blocks.get(link.sourceBlockId)
          if (!sourceBlock) continue
          const sourcePageId = sourceBlock.pageId

          // 情况 1：当前页面是源（出链）
          if (sourcePageId === pageId) {
            const targetPageId = link.targetPageId

            // 添加边
            const edgeId = `${sourcePageId}-${targetPageId}-${link.id}`
            const config = getRelationshipConfig(link.relationshipType)
            edgesMap.set(edgeId, {
              id: edgeId,
              source: sourcePageId,
              target: targetPageId,
              relationshipType: link.relationshipType,
              relationshipLabel: config.label,
              relationshipColor: config.color
            })

            // 添加目标节点到队列（如果还没处理过）
            if (!processedPages.has(targetPageId)) {
              const targetPage = await db.pages.get(targetPageId)
              if (targetPage) {
                nodesMap.set(targetPageId, {
                  id: targetPageId,
                  title: targetPage.title
                })
                queue.push({ pageId: targetPageId, depth: depth + 1 })
              }
            }
          }

          // 情况 2：当前页面是目标（入链）
          if (link.targetPageId === pageId) {
            const sourcePageId = sourceBlock.pageId

            // 添加边
            const edgeId = `${sourcePageId}-${pageId}-${link.id}`
            const config = getRelationshipConfig(link.relationshipType)
            edgesMap.set(edgeId, {
              id: edgeId,
              source: sourcePageId,
              target: pageId,
              relationshipType: link.relationshipType,
              relationshipLabel: config.label,
              relationshipColor: config.color
            })

            // 添加源节点到队列（如果还没处理过）
            if (!processedPages.has(sourcePageId)) {
              const sourcePage = await db.pages.get(sourcePageId)
              if (sourcePage) {
                nodesMap.set(sourcePageId, {
                  id: sourcePageId,
                  title: sourcePage.title
                })
                queue.push({ pageId: sourcePageId, depth: depth + 1 })
              }
            }
          }
        }
      }
    }

    return {
      nodes: Array.from(nodesMap.values()),
      edges: Array.from(edgesMap.values())
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
