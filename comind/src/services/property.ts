import { generateUUID } from '../utils/id'
import { storage } from '../storage/indexedDB'
import type { Property, PropertyValue, PropertyType, PropertyDefinition } from '../types/property'
import { getPropertyDefinition, getAllPropertyDefinitions } from '../types/property'
import { formatPropertyValue } from '../utils/property'

/**
 * Property Service - 业务逻辑层
 */
export class PropertyService {
  /**
   * 获取 Block 的所有属性
   */
  async getProperties(blockId: string): Promise<Property[]> {
    return storage.getProperties(blockId)
  }

  /**
   * 获取 Block 的特定属性
   */
  async getProperty(blockId: string, key: string): Promise<Property | undefined> {
    return storage.getProperty(blockId, key)
  }

  /**
   * 批量获取多个 Block 的属性
   */
  async getPropertiesByBlockIds(blockIds: string[]): Promise<Map<string, Property[]>> {
    return storage.getPropertiesByBlockIds(blockIds)
  }

  /**
   * 创建或更新属性
   * 同一 Block 同一 Key 会覆盖
   */
  async setProperty(
    blockId: string,
    key: string,
    value: PropertyValue,
    type?: PropertyType
  ): Promise<Property> {
    const now = Date.now()

    // 获取属性定义
    const definition = getPropertyDefinition(key)
    const propertyType = type || definition?.type || 'string'

    // 格式化和验证值
    const formattedValue = formatPropertyValue(value, propertyType)
    if (formattedValue === null) {
      throw new Error(`Invalid value for property ${key} of type ${propertyType}`)
    }

    // 检查属性是否已存在
    const existing = await this.getProperty(blockId, key)

    if (existing) {
      // 更新现有属性
      const updated: Property = {
        ...existing,
        value: formattedValue,
        type: propertyType,
        updatedAt: now,
      }
      await storage.saveProperty(updated)
      return updated
    } else {
      // 创建新属性 - 计算排序
      const existingProps = await this.getProperties(blockId)
      const maxSortOrder = existingProps.length > 0
        ? Math.max(...existingProps.map(p => p.sortOrder))
        : -1

      const newProperty: Property = {
        id: generateUUID(),
        blockId,
        key,
        value: formattedValue,
        type: propertyType,
        sortOrder: maxSortOrder + 1,
        isHidden: false,
        isDeleted: false,
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
      }

      await storage.saveProperty(newProperty)
      return newProperty
    }
  }

  /**
   * 软删除属性
   */
  async deleteProperty(id: string): Promise<void> {
    return storage.deleteProperty(id)
  }

  /**
   * 硬删除属性
   */
  async hardDeleteProperty(id: string): Promise<void> {
    return storage.hardDeleteProperty(id)
  }

  /**
   * 级联删除 Block 的所有属性（物理删除）
   */
  async deletePropertiesByBlockId(blockId: string): Promise<void> {
    return storage.deletePropertiesByBlockId(blockId)
  }

  /**
   * 更新属性排序
   */
  async updateSortOrder(blockId: string, sortedIds: string[]): Promise<void> {
    const properties = await this.getProperties(blockId)
    const map = new Map(properties.map(p => [p.id, p]))

    for (let i = 0; i < sortedIds.length; i++) {
      const prop = map.get(sortedIds[i])
      if (prop) {
        prop.sortOrder = i
        prop.updatedAt = Date.now()
        await storage.saveProperty(prop)
      }
    }
  }

  /**
   * 切换属性显示/隐藏
   */
  async toggleHidden(id: string): Promise<Property> {
    const prop = await storage.getPropertyById(id)
    if (!prop) {
      throw new Error('Property not found')
    }
    prop.isHidden = !prop.isHidden
    prop.updatedAt = Date.now()
    await storage.saveProperty(prop)
    return prop
  }

  /**
   * 获取属性定义
   */
  getPropertyDefinition(key: string): PropertyDefinition | undefined {
    return getPropertyDefinition(key)
  }

  /**
   * 获取所有属性定义
   */
  getAllPropertyDefinitions(): PropertyDefinition[] {
    return getAllPropertyDefinitions()
  }
}

export const propertyService = new PropertyService()
