/**
 * Core Layer - Page 服务
 *
 * 提供 Page 相关的业务逻辑，与框架无关。
 */

import type {
  Page,
  PageCreateOptions,
  PageUpdateOptions,
} from '../types'
import type { PageRepository, StorageAdapter } from '../storage/adapter'

/**
 * Page Service 选项
 */
export interface PageServiceOptions {
  storage: StorageAdapter
}

/**
 * Page Service
 *
 * 提供 Page 相关的业务逻辑，包括：
 * - Page CRUD 操作
 * - 回收站管理
 * - 页面合并
 */
export class PageService {
  private storage: StorageAdapter

  constructor(options: PageServiceOptions) {
    this.storage = options.storage
  }

  /**
   * 获取 Page Repository
   */
  get repository(): PageRepository {
    return this.storage.pages
  }

  /**
   * 根据 ID 获取 Page
   */
  async getById(id: string): Promise<Page | undefined> {
    return this.repository.findById(id)
  }

  /**
   * 根据标题获取 Page
   */
  async getByTitle(title: string): Promise<Page | undefined> {
    return this.repository.findByTitle(title)
  }

  /**
   * 获取所有 Page
   */
  async getAll(): Promise<Page[]> {
    const result = await this.repository.findAll(1000, 0)
    return result.items.filter(p => !p.deleted)
  }

  /**
   * 获取最近的 Page
   */
  async getRecent(limit = 10): Promise<Page[]> {
    return this.repository.findRecent(limit)
  }

  /**
   * 获取回收站中的 Page
   */
  async getDeleted(limit = 100, offset = 0) {
    return this.repository.findDeleted(limit, offset)
  }

  /**
   * 创建 Page
   */
  async create(options: PageCreateOptions): Promise<Page> {
    return this.repository.create(options)
  }

  /**
   * 更新 Page
   */
  async update(id: string, options: PageUpdateOptions): Promise<Page> {
    return this.repository.update(id, options)
  }

  /**
   * 重命名 Page
   */
  async rename(id: string, newTitle: string): Promise<Page> {
    return this.repository.update(id, { title: newTitle })
  }

  /**
   * 软删除 Page（移至回收站）
   */
  async softDelete(id: string): Promise<void> {
    return this.repository.softDelete(id)
  }

  /**
   * 恢复 Page
   */
  async restore(id: string): Promise<void> {
    return this.repository.restore(id)
  }

  /**
   * 永久删除 Page
   */
  async permanentDelete(id: string): Promise<void> {
    return this.repository.permanentDelete(id)
  }

  /**
   * 清空回收站
   */
  async emptyTrash(): Promise<void> {
    return this.repository.emptyTrash()
  }

  /**
   * 根据标题获取回收站中的页面
   */
  async getTrashedPageByTitle(title: string): Promise<Page | undefined> {
    const deleted = await this.repository.findDeleted(1000, 0)
    return deleted.items.find(p => p.title === title)
  }

  /**
   * 更新页面（完整对象更新）
   */
  async updatePage(page: Page): Promise<void> {
    await this.repository.update(page.id, {
      title: page.title,
      icon: page.icon,
      type: page.type,
      cover: page.cover,
      aliases: page.aliases,
      filePath: page.filePath,
    })
  }

  /**
   * 删除页面（级联删除 blocks 和 links）
   */
  async deletePage(pageId: string): Promise<void> {
    await this.storage.transaction(async () => {
      const blocks = await this.storage.blocks.findByPageId(pageId)
      const blockIds = blocks.map(b => b.id)

      for (const blockId of blockIds) {
        await this.storage.links.deleteBySourceBlockId(blockId)
      }

      for (const blockId of blockIds) {
        await this.storage.blocks.delete(blockId)
      }

      await this.storage.links.deleteByTargetPageId(pageId)

      await this.repository.permanentDelete(pageId)
    })
  }

  /**
   * 合并两个页面
   */
  async mergePage(sourceId: string, targetId: string): Promise<void> {
    await this.storage.transaction(async () => {
      const sourcePage = await this.repository.findById(sourceId)
      const targetPage = await this.repository.findById(targetId)
      if (!sourcePage || !targetPage) return

      const sourceBlocks = await this.storage.blocks.findByPageId(sourceId)

      for (const block of sourceBlocks) {
        const newBlock = await this.storage.blocks.create({
          pageId: targetId,
          parentId: null,
          content: block.content,
          type: block.type,
        })

        const links = await this.storage.links.findBySourceBlockId(block.id)
        for (const link of links) {
          await this.storage.links.create({
            sourceBlockId: newBlock.id,
            targetPageId: link.targetPageId,
            displayText: link.displayText,
            relationshipType: link.relationshipType,
          })
        }

        const props = await this.storage.properties.findByBlockId(block.id)
        for (const prop of props) {
          await this.storage.properties.create({
            blockId: newBlock.id,
            key: prop.key,
            value: prop.value,
            type: prop.type,
          })
        }
      }

      await this.deletePage(sourceId)
    })
  }
}
