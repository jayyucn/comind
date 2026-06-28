/**
 * Core Layer - 关系类型服务
 *
 * 提供关系类型相关的业务逻辑，与框架无关。
 */

import type { RelationshipType, RelationshipTypeCreateOptions, RelationshipTypeUpdateOptions } from '../types'
import type { RelationshipTypeRepository, StorageAdapter } from '../storage/adapter'

/**
 * RelationshipType Service 选项
 */
export interface RelationshipTypeServiceOptions {
  storage: StorageAdapter
}

/**
 * RelationshipType Service
 *
 * 提供关系类型相关的业务逻辑，包括：
 * - 关系类型 CRUD 操作
 * - 种子数据初始化
 * - 分组查询
 */
export class RelationshipTypeService {
  private storage: StorageAdapter

  constructor(options: RelationshipTypeServiceOptions) {
    this.storage = options.storage
  }

  /**
   * 获取 RelationshipType Repository
   */
  get repository(): RelationshipTypeRepository {
    return this.storage.relationshipTypes
  }

  /**
   * 根据 ID 获取关系类型
   */
  async getById(id: string): Promise<RelationshipType | undefined> {
    return this.repository.findById(id)
  }

  /**
   * 根据类型标识获取关系类型
   */
  async getByType(type: string): Promise<RelationshipType | undefined> {
    return this.repository.findByType(type)
  }

  /**
   * 获取所有关系类型（含已删除）
   */
  async getAll(): Promise<RelationshipType[]> {
    const result = await this.repository.findAll(1000, 0)
    return result.items
  }

  /**
   * 获取活跃的关系类型（未删除）
   */
  async getActive(): Promise<RelationshipType[]> {
    return this.repository.findActive()
  }

  /**
   * 根据分组获取关系类型
   */
  async getByGroup(group: string): Promise<RelationshipType[]> {
    return this.repository.findByGroup(group)
  }

  /**
   * 创建关系类型
   */
  async create(options: RelationshipTypeCreateOptions): Promise<RelationshipType> {
    return this.repository.create(options)
  }

  /**
   * 更新关系类型
   */
  async update(id: string, options: RelationshipTypeUpdateOptions): Promise<RelationshipType> {
    return this.repository.update(id, options)
  }

  /**
   * 软删除关系类型
   */
  async softDelete(id: string): Promise<void> {
    return this.repository.softDelete(id)
  }

  /**
   * 恢复关系类型
   */
  async restore(id: string): Promise<void> {
    return this.repository.restore(id)
  }

  /**
   * 获取反向关系类型
   */
  async getInverse(type: string): Promise<RelationshipType | undefined> {
    const rt = await this.repository.findByType(type)
    if (!rt || !rt.inverse) return undefined
    return this.repository.findByType(rt.inverse)
  }

  /**
   * 批量更新排序
   */
  async updateOrder(ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i++) {
      await this.repository.update(ids[i], { order: i })
    }
  }
}
