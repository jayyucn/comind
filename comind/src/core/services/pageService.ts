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
    return result.items
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
}
