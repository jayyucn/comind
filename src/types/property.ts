import { SYSTEM_TAGS } from './tag'

/**
 * 属性类型
 */
export type PropertyType = 'string' | 'number' | 'boolean' | 'date' | 'array' | 'page'

/**
 * 封闭值选项
 */
export interface ClosedValue {
  value: string | number | boolean
  label: string
  description?: string
  icon?: string
}

/**
 * 字段定义（元数据）
 * 全局配置，描述一个字段的元信息。系统字段由 SYSTEM_TAGS 分组定义（ADR-0049 D1/D3）。
 */
export interface FieldDefinition {
  key: string
  title: string
  type: PropertyType
  closedValues?: ClosedValue[]
  description?: string

  // 纯渲染语义：不再承担「是否系统字段」职责（系统语义由所属 Tag.isSystem 承载，见 isSystemField）
  displayPosition?: 'between-bullet-content' | 'right-of-content' | 'bottom-of-block'
  displayStyle?: 'icon-text' | 'icon' | 'text'
}

/**
 * @deprecated 使用 FieldDefinition（ADR-0049 D2 改名）
 */
export type PropertyDefinition = FieldDefinition

/**
 * 属性值映射（类型安全）
 */
export type PropertyValueMap = {
  string: string
  number: number
  boolean: boolean
  date: string
  array: string[]
  page: string
}

export type PropertyValue = PropertyValueMap[PropertyType]

/**
 * 属性实例
 * 存储在数据库中的实际数据
 */
export interface Property<T = PropertyValue> {
  id: string
  blockId: string
  key: string
  value: T
  type: PropertyType
  sortOrder: number
  isHidden: boolean
  isDeleted: boolean
  schemaVersion: number
  createdAt: number
  updatedAt: number
}

/**
 * 属性存储记录（IndexedDB）
 */
export interface PropertyRecord {
  id: string
  blockId: string
  key: string
  value: string
  type: string
  sortOrder: number
  isHidden: number
  isDeleted: number
  schemaVersion: number
  createdAt: number
  updatedAt: number
}

/**
 * 内置字段定义：由 SYSTEM_TAGS 展平（单一来源，见 ADR-0049 D3）。
 */
export const BUILT_IN_PROPERTIES: FieldDefinition[] = SYSTEM_TAGS.flatMap((s) => s.fields)

/**
 * 获取字段定义
 */
export function getPropertyDefinition(key: string): FieldDefinition | undefined {
  return BUILT_IN_PROPERTIES.find((p) => p.key === key)
}

/**
 * 获取所有字段定义
 */
export function getAllPropertyDefinitions(): FieldDefinition[] {
  return [...BUILT_IN_PROPERTIES]
}
