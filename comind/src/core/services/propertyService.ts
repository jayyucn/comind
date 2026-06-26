/**
 * Core Layer - Property 服务
 *
 * 提供 Property（属性）相关的业务逻辑。
 */

import type {
  Property,
  PropertyType,
  PropertyValue,
} from '../types'
import type { PropertyRepository, StorageAdapter } from '../storage/adapter'

/**
 * Property Service 选项
 */
export interface PropertyServiceOptions {
  storage: StorageAdapter
}

/**
 * 属性类型推断结果
 */
export interface PropertyTypeInference {
  type: PropertyType
  value: PropertyValue
}

/**
 * Property Service
 *
 * 提供 Property 相关的业务逻辑，包括：
 * - Property CRUD 操作
 * - 属性类型推断
 * - 属性定义管理
 */
export class PropertyService {
  private storage: StorageAdapter

  constructor(options: PropertyServiceOptions) {
    this.storage = options.storage
  }

  /**
   * 获取 Property Repository
   */
  get repository(): PropertyRepository {
    return this.storage.properties
  }

  /**
   * 根据 Block ID 获取所有属性
   */
  async getByBlockId(blockId: string): Promise<Property[]> {
    return this.repository.findByBlockId(blockId)
  }

  /**
   * 根据 Block ID 和 Key 获取属性
   */
  async getByKey(blockId: string, key: string): Promise<Property | undefined> {
    return this.repository.findByKey(blockId, key)
  }

  /**
   * 设置属性
   *
   * 如果属性已存在则更新，否则创建新属性。
   */
  async setProperty(
    blockId: string,
    key: string,
    value: PropertyValue,
    type?: PropertyType
  ): Promise<Property> {
    // 检查属性是否已存在
    const existing = await this.repository.findByKey(blockId, key)
    if (existing) {
      return this.repository.update(existing.id, { value })
    }

    // 推断类型
    const inferred = this.inferType(value)

    return this.repository.create({
      blockId,
      key,
      value,
      type: type ?? inferred.type,
    })
  }

  /**
   * 删除属性
   *
   * @param blockId Block ID
   * @param key 属性键
   */
  async deleteProperty(blockId: string, key: string): Promise<void> {
    await this.repository.deleteByBlockIdAndKey(blockId, key)
  }

  /**
   * 删除属性（通过 ID）
   *
   * @param id 属性 ID
   */
  async deletePropertyById(id: string): Promise<void> {
    await this.repository.delete(id)
  }

  /**
   * 更新属性排序
   */
  async updateSortOrder(blockId: string, sortedIds: string[]): Promise<void> {
    const properties = await this.repository.findByBlockId(blockId)
    const map = new Map(properties.map(p => [p.id, p]))

    for (let i = 0; i < sortedIds.length; i++) {
      const prop = map.get(sortedIds[i])
      if (prop) {
        await this.repository.update(prop.id, { sortOrder: i })
      }
    }
  }

  /**
   * 切换属性显示/隐藏
   */
  async toggleHidden(id: string): Promise<Property> {
    const prop = await this.repository.findById(id)
    if (!prop) {
      throw new Error('Property not found')
    }
    return this.repository.update(id, { isHidden: !prop.isHidden })
  }

  /**
   * 删除 Block 的所有属性
   */
  async deleteByBlockId(blockId: string): Promise<void> {
    await this.repository.deleteByBlockId(blockId)
  }

  /**
   * 推断属性值的类型
   *
   * @param value 属性值
   * @returns 推断的类型和转换后的值
   */
  inferType(value: any): PropertyTypeInference {
    if (typeof value === 'boolean') {
      return { type: 'boolean', value }
    }

    if (typeof value === 'number') {
      return { type: 'number', value }
    }

    if (Array.isArray(value)) {
      return { type: 'array', value: value as string[] }
    }

    if (typeof value === 'string') {
      // 日期格式检测
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return { type: 'date', value }
      }
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
        return { type: 'datetime', value }
      }
      // 布尔值字符串
      if (value === 'true') {
        return { type: 'boolean', value: true }
      }
      if (value === 'false') {
        return { type: 'boolean', value: false }
      }
      // 数字字符串
      const num = Number(value)
      if (!isNaN(num) && value.trim() !== '') {
        return { type: 'number', value: num }
      }
    }

    return { type: 'string', value: String(value) }
  }

  /**
   * 从 Block 内容中解析属性
   *
   * 匹配 `key:: value` 格式。
   *
   * @param content Block 内容
   * @returns 解析出的属性映射
   */
  parseProperties(content: string): Record<string, any> {
    const properties: Record<string, any> = {}
    const regex = /([\p{L}_][\p{L}\p{N}_]*)::([^\n]*)/gu

    let match: RegExpExecArray | null
    while ((match = regex.exec(content)) !== null) {
      const key = match[1]
      const valueStr = match[2].trim()
      const { value } = this.inferType(valueStr)
      properties[key] = value
    }

    return properties
  }

  /**
   * 同步 Block 的属性
   *
   * 解析 Block 内容中的属性，与数据库中的属性同步。
   */
  async syncBlockProperties(blockId: string, content: string): Promise<void> {
    const parsedProperties = this.parseProperties(content)
    const existingProperties = await this.repository.findByBlockId(blockId)
    const existingMap = new Map(existingProperties.map(p => [p.key, p]))

    await this.storage.transaction(async () => {
      // 删除不再存在的属性
      for (const prop of existingProperties) {
        if (!(prop.key in parsedProperties)) {
          await this.repository.delete(prop.id)
        }
      }

      // 添加或更新属性
      for (const [key, value] of Object.entries(parsedProperties)) {
        const existing = existingMap.get(key)
        if (existing) {
          await this.repository.update(existing.id, { value })
        } else {
          const { type } = this.inferType(value)
          await this.repository.create({ blockId, key, value, type })
        }
      }
    })
  }
}
