/**
 * Core Layer - Link 服务
 *
 * 提供 Link（双向链接）相关的业务逻辑。
 */

import type { Link, LinkCreateOptions, LinkParse } from '../types'
import type { LinkRepository, StorageAdapter } from '../storage/adapter'

/**
 * Link Service 选项
 */
export interface LinkServiceOptions {
  storage: StorageAdapter
}

/**
 * Link Service
 *
 * 提供 Link 相关的业务逻辑，包括：
 * - Link CRUD 操作
 * - 链接解析
 * - 反向链接查询
 */
export class LinkService {
  private storage: StorageAdapter

  constructor(options: LinkServiceOptions) {
    this.storage = options.storage
  }

  /**
   * 获取 Link Repository
   */
  get repository(): LinkRepository {
    return this.storage.links
  }

  /**
   * 根据 ID 获取 Link
   */
  async getById(id: string): Promise<Link | undefined> {
    return this.repository.findById(id)
  }

  /**
   * 根据源 Block 获取所有 Link
   */
  async getBySourceBlockId(blockId: string): Promise<Link[]> {
    return this.repository.findBySourceBlockId(blockId)
  }

  /**
   * 根据目标 Page 获取所有 Link（反向链接）
   */
  async getBacklinks(pageId: string): Promise<Link[]> {
    return this.repository.findByTargetPageId(pageId)
  }

  /**
   * 根据源 Page 获取所有 Link
   *
   * 查询该页面所有 Block 的出链
   */
  async getBySourcePage(pageId: string): Promise<Link[]> {
    const allLinks = await this.repository.findAll(1000, 0)
    return allLinks.items.filter(link => link.sourceBlockId.startsWith(pageId))
  }

  /**
   * 根据目标 Page 获取所有 Link
   *
   * 与 getBacklinks 功能相同，提供别名
   */
  async getByTargetPage(pageId: string): Promise<Link[]> {
    return this.repository.findByTargetPageId(pageId)
  }

  /**
   * 根据关系类型获取链接
   */
  async getByRelationshipType(pageId: string, relationshipType?: string): Promise<Link[]> {
    const allLinks = await this.repository.findAll(1000, 0)
    const filtered = allLinks.items.filter(link => {
      const matchesType = relationshipType 
        ? link.relationshipType === relationshipType
        : link.relationshipType !== null
      return matchesType && (link.sourceBlockId.startsWith(pageId) || link.targetPageId === pageId)
    })
    return filtered
  }

  /**
   * 创建 Link
   */
  async create(options: LinkCreateOptions): Promise<Link> {
    return this.repository.create(options)
  }

  /**
   * 创建多个 Link
   */
  async createMany(optionsList: LinkCreateOptions[]): Promise<Link[]> {
    return this.storage.transaction(async () => {
      const links: Link[] = []
      for (const options of optionsList) {
        const link = await this.repository.create(options)
        links.push(link)
      }
      return links
    })
  }

  /**
   * 删除源 Block 的所有 Link
   */
  async deleteBySourceBlockId(blockId: string): Promise<void> {
    await this.repository.deleteBySourceBlockId(blockId)
  }

  /**
   * 同步 Block 的链接
   *
   * 解析 Block 内容中的链接，与数据库中的链接同步。
   * - 删除不再存在的链接
   * - 添加新的链接
   */
  async syncBlockLinks(blockId: string, _pageId: string, parsedLinks: LinkParse[]): Promise<void> {
    const existingLinks = await this.repository.findBySourceBlockId(blockId)
    const existingMap = new Map(existingLinks.map(l => [`${l.targetPageId}:${l.displayText}`, l]))

    const newMap = new Map<string, LinkCreateOptions>()
    for (const parsed of parsedLinks) {
      if (parsed.isExternal) continue
      const key = `${parsed.target}:${parsed.displayText ?? ''}`
      if (!newMap.has(key)) {
        newMap.set(key, {
          sourceBlockId: blockId,
          targetPageId: parsed.target,
          displayText: parsed.displayText ?? parsed.target,
        })
      }
    }

    await this.storage.transaction(async () => {
      // 删除不再存在的链接
      for (const [key, link] of existingMap) {
        if (!newMap.has(key)) {
          await this.repository.delete(link.id)
        }
      }

      // 添加新链接
      for (const [key, options] of newMap) {
        if (!existingMap.has(key)) {
          await this.repository.create(options)
        }
      }
    })
  }
}
