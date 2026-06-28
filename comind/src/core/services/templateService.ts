/**
 * Core Layer - 模板服务
 *
 * 提供用户模板相关的业务逻辑，与框架无关。
 */

import type { UserTemplate, TemplateCreateOptions, TemplateUpdateOptions } from '../types'
import type { TemplateRepository, StorageAdapter } from '../storage/adapter'

/**
 * Template Service 选项
 */
export interface TemplateServiceOptions {
  storage: StorageAdapter
}

/**
 * Template Service
 *
 * 提供用户模板相关的业务逻辑，包括：
 * - 模板 CRUD 操作
 * - 按分类查询
 */
export class TemplateService {
  private storage: StorageAdapter

  constructor(options: TemplateServiceOptions) {
    this.storage = options.storage
  }

  /**
   * 获取 Template Repository
   */
  get repository(): TemplateRepository {
    return this.storage.templates
  }

  /**
   * 根据 ID 获取模板
   */
  async getById(id: string): Promise<UserTemplate | undefined> {
    return this.repository.findById(id)
  }

  /**
   * 获取所有模板
   */
  async getAll(): Promise<UserTemplate[]> {
    const result = await this.repository.findAll(1000, 0)
    return result.items
  }

  /**
   * 根据分类获取模板
   */
  async getByCategory(category: string): Promise<UserTemplate[]> {
    return this.repository.findByCategory(category)
  }

  /**
   * 创建模板
   */
  async create(options: TemplateCreateOptions): Promise<UserTemplate> {
    return this.repository.create(options)
  }

  /**
   * 更新模板
   */
  async update(id: string, options: TemplateUpdateOptions): Promise<UserTemplate> {
    return this.repository.update(id, options)
  }

  /**
   * 删除模板
   */
  async delete(id: string): Promise<void> {
    return this.repository.delete(id)
  }
}
