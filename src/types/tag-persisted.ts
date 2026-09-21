/**
 * ADR-0049 D6：Tag 统一字段模型的**落库持久化形态**（与 Rust 端逐字段对齐）。
 *
 * ⚠️ 命名区分：这里的 `Persisted*` 是数据库里的真实行（标识为 `id`、带
 * `version`/`deleted_at` 参与 LWW 同步）；而 `./tag.ts` 的 `Tag` 与
 * `./property.ts` 的 `FieldDefinition` 是**编译期系统常量形**（标识为 `key`，
 * 额外承载图标 / displayPosition / displayStyle 等展示字段，Rust 库表刻意不存）。
 * 二者不是冗余关系 —— FieldValue 行要靠 `field_definition_id` 外键引用，
 * 数据库行没法引用一个 TS 编译期常量，所以持久化形必须独立存在。
 *
 * 字段名保持 snake_case：Rust 端未启用 `rename_all`，JSON 契约即 snake_case。
 */

/** Tag 表行：字段模板（用户自定义；系统 Tag 为常量，不落库）。 */
export interface PersistedTag {
  id: string
  /** 全局唯一标题 */
  title: string
  /** 字段定义 id 列表（含继承展开后的最终集合） */
  field_ids: string[]
  /** 多继承父 Tag id */
  extends: string[]
  created_at: number
  updated_at: number
  version: number
  deleted_at: number | null
}

/** FieldDefinition 表行：字段定义（系统 12 字段 seed 进本表，is_system=true）。 */
export interface PersistedFieldDefinition {
  id: string
  key: string
  title: string
  type: string
  /** 选项型字段的候选值；非选项型为 null */
  closed_values: string[] | null
  is_system: boolean
  created_at: number
  updated_at: number
  version: number
  deleted_at: number | null
}

/** FieldValue 表行：字段值（重构自 Property，强引用 FieldDefinition）。 */
export interface PersistedFieldValue {
  id: string
  block_id: string
  field_definition_id: string
  /** 按 value_type 反序列化的 JSON 文本 */
  value_json: string
  value_type: string
  /** 同 block 多值的有序序号 */
  seq: number
  created_at: number
  updated_at: number
  version: number
  deleted_at: number | null
}

// 入参用 `type` 而非 `interface`：BatchOperation.params 是 Record<string, unknown>，
// 而 TS 只对**对象字面量类型别名**给隐式索引签名，interface 不给（会报
// "Index signature for type 'string' is missing"）。

export type CreateTagParams = {
  title: string
  field_ids?: string[]
  extends?: string[]
}

export type UpdateTagParams = {
  id: string
  title?: string
  field_ids?: string[]
  extends?: string[]
}

export type CreateFieldDefinitionParams = {
  key: string
  title: string
  type: string
  closed_values?: string[] | null
}

export type UpdateFieldDefinitionParams = {
  id: string
  title?: string
  type?: string
  /** 显式传 null 表示清空候选值（降为非选项型）；不传则保持原值 */
  closed_values?: string[] | null
}

export type CreateFieldValueParams = {
  block_id: string
  field_definition_id: string
  value_json: string
  value_type: string
  seq?: number
}

export type UpdateFieldValueParams = {
  id: string
  value_json?: string
  value_type?: string
  seq?: number
}

/** 删 FieldDefinition 的回执（ADR D9：删前告知受影响条目数）。 */
export interface DeleteFieldDefinitionResult {
  success: boolean
  affected_values: number
}
