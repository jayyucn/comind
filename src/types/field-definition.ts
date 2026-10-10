import { SYSTEM_TAGS } from './tag'

/**
 * 字段类型 —— 规范联合（单源，issue #140 F1）。
 *
 * 领域层与查询引擎层（`core/query/types.ts`）共用本枚举：查询引擎 re-export 此处
 * 定义并保留 `(string & {})` 开放扩展。编辑器 / 展示形态 / 过滤操作符的三面分派
 * 统一查中央注册表（`field-type-registry.ts`），不再各自维护散表。
 *
 * - datetime：日期时间（yyyy-MM-dd HH:mm，ADR-0041）
 * - select / multiSelect：封闭枚举单选 / 多选（选项在 closedValues，值存选项 id）
 * - array / page / boolean / string / number / date：既有词汇，保持不变
 */
export type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'select'
  | 'multiSelect'
  | 'array'
  | 'page'

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

  // 数值约束（ADR-0055）：仅 type==='number' 时生效；null/undefined = 无约束。
  // 单一来源——编译期 FieldDefinition 与持久化 PersistedFieldDefinition 两处都带，
  // 由字段管理面板配置后经 Rust 持久化列落库。
  min?: number | null
  max?: number | null
  step?: number | null
}

/**
 * 字段值域映射（类型安全）。datetime / select 值为字符串（后者存选项 id），
 * multiSelect 值为选项 id 数组。
 */
export type FieldValueDataMap = {
  string: string
  number: number
  boolean: boolean
  date: string
  datetime: string
  select: string
  multiSelect: string[]
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
