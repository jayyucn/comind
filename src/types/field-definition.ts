import { SYSTEM_TAGS } from './tag'

/**
 * 字段类型
 */
export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'array' | 'page'

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
  type: FieldType
  closedValues?: ClosedValue[]
  description?: string

  // 纯渲染语义：不再承担「是否系统字段」职责（系统语义由所属 Tag.isSystem 承载，见 isSystemField）
  displayPosition?: 'between-bullet-content' | 'right-of-content' | 'bottom-of-block'
  displayStyle?: 'icon-text' | 'icon' | 'text'
}

/**
 * 字段值域映射（类型安全）
 */
export type FieldValueDataMap = {
  string: string
  number: number
  boolean: boolean
  date: string
  array: string[]
  page: string
}

/** 字段的内存值形态（编解码后） */
export type FieldValueData = FieldValueDataMap[FieldType]

/**
 * 内置字段定义：由 SYSTEM_TAGS 展平（单一来源，见 ADR-0049 D3）。
 */
export const BUILT_IN_FIELDS: FieldDefinition[] = SYSTEM_TAGS.flatMap((s) => s.fields)

/**
 * 获取字段定义
 */
export function getFieldDefinition(key: string): FieldDefinition | undefined {
  return BUILT_IN_FIELDS.find((f) => f.key === key)
}

/**
 * 获取所有字段定义
 */
export function getAllFieldDefinitions(): FieldDefinition[] {
  return [...BUILT_IN_FIELDS]
}
