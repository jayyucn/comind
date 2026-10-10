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
  /** 字段定义 id 列表（**仅自身**字段；继承不物化，ADR-0050 D10） */
  field_ids: string[]
  /** 单父 Tag id（null = 顶级标签；ADR-0050 D10） */
  parent_id: string | null
  /** 标签身份三要素之二：单行描述；空串 = 未填写（ADR-0050 D11） */
  description: string
  /** 标签身份三要素之三：调色板 token 名（如 `--tag-color-3`）；空串 = 无色（ADR-0050 D11） */
  color: string
  /** 系统 seed 行标记（拒删 / 拒改名 / 拒改父；ADR-0049 grill 决策 #5/#9） */
  is_system: boolean
  /**
   * 预设标记（ADR-0049 系统标签三态模型，2026-09-30）：随应用首启分发、用户可改可删、删后可恢复。
   * 当前仅域字段使用；标签容器（#任务 / #书笔记）维持 is_system=1，本列恒 false。
   * 与 `is_system` 正交：预设 ≠ 系统，仅预设删除后可经「恢复内置预设」复活。
   */
  is_preset?: boolean
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
  /**
   * 选项型字段的候选值；非选项型为 null。
   * relation 字段（issue T5）复用本列携带约定的关系类型 id（单元素数组
   * `[relationshipTypeId]`）——既有持久化列、Rust 侧原样存取字符串数组，
   * 无需迁移；null / 空 = 未约定（值编辑器仍可逐值任选关系类型）。
   * 注意消费端（BlockFieldZone.isEnumField 等）须按 type==='relation' 排除，
   * 避免被误判为选项型枚举。
   */
  closed_values: string[] | null
  /** 字段默认值：JSON 文本（与 PersistedFieldValue.value_json 同形，按 type 反序列化）；null = 无默认 */
  default_value: string | null
  /**
   * 块属性展示的隐藏规则（ADR-0050 D18）：never / when_empty / when_not_empty /
   * when_default / always。定义级全局共享，作用于块级字段区（BlockFieldZone）。
   */
  hide_when: string
  /**
   * 块字段区展示形态的用户覆盖（ADR-0050 D21 决策 5）：auto / icon / icon-text /
   * text / chip。`auto` = 跟随类型默认映射；系统字段不可配，恒 `auto`（决策 6）。
   */
  display_form_override?: string | null
  /** 数值约束（ADR-0055）：仅 type==='number' 生效；null = 无约束。经字段管理面板配置后落库。 */
  min?: number | null
  max?: number | null
  step?: number | null
  /**
   * 特化标记（issue T6）：'email' | 'phone' | 'url' | 'richtext'，开放 string 供
   * 其他类型特化复用（T7）。⚠️ 持久化列尚未落 Rust——本轮约定不动 Rust 迁移，
   * 且 FieldDefinition 表无既有扩展 JSON 列可复用（display_form_override / hide_when
   * 均为白名单归一列，default_value 语义被占），故 Rust 回读不含本字段
   * （undefined = 无特化）；会话内由 tags store 在 spec 写入后回贴本地条目。
   * 跨会话持久化需后续 `ALTER TABLE FieldDefinition ADD COLUMN spec TEXT`（见 T6 报告）。
   */
  spec?: string
  is_system: boolean
  /**
   * 预设标记（ADR-0049 系统标签三态模型，2026-09-30）：域字段（project/area/book/...）
   * 落此标记，随应用首启分发、用户可改可删、删后可经「恢复内置预设」复活；系统字段（status/priority）恒 false。
   */
  is_preset?: boolean
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
  /** 可选父标签（缺失 / null → 顶级） */
  parent_id?: string | null
}

export type UpdateTagParams = {
  id: string
  title?: string
  field_ids?: string[]
  /** 缺失 = 保持不变；**空串 = 清空**（未填写，ADR-0050 D11） */
  description?: string
  /** 同上；空串 = 无色 */
  color?: string
}

export type SetTagParentParams = {
  id: string
  /** null / 缺失 → 清空回顶级 */
  parent_id?: string | null
}

/**
 * 标签树读接口行（ADR-0050 D10）：`PersistedTag` + Rust 侧解析结果。
 *
 * `effective_field_ids` = 自身 > 直接父 > 更近祖先（同名近者胜）；
 * `descendant_ids` = 后代标签闭包（**不含自身**）→ 成员命中集合 = `[id, ...descendant_ids]`。
 * 解析单源在 Rust，前端只消费。
 */
export interface PersistedTagTreeEntry extends PersistedTag {
  effective_field_ids: string[]
  descendant_ids: string[]
}

export type CreateFieldDefinitionParams = {
  key: string
  title: string
  type: string
  closed_values?: string[] | null
  /** 字段默认值（JSON 文本）；缺省 = 无默认 */
  default_value?: string | null
  /** 数值字段约束（ADR-0055 D5）：下界 / 上界 / 步进；缺省 = 无约束 */
  min?: number | null
  max?: number | null
  step?: number | null
}

export type UpdateFieldDefinitionParams = {
  id: string
  title?: string
  type?: string
  /** 显式传 null 表示清空候选值（降为非选项型）；不传则保持原值 */
  closed_values?: string[] | null
  /** 显式传 null / 空 = 清空默认；不传则保持原值 */
  default_value?: string | null
  /** 隐藏规则（ADR-0050 D18）；Rust 侧按白名单归一，未知值回落 never */
  hide_when?: string
  /** 展示形态覆盖（ADR-0050 D21 决策 5）；Rust 侧按白名单归一，未知值回落 auto */
  display_form_override?: string
  /** 数值字段约束（ADR-0055 D5）：下界 / 上界 / 步进；显式传 null 清空约束，不传保持原值 */
  min?: number | null
  max?: number | null
  step?: number | null
  /** 特化标记（issue T6）：email / phone / url / richtext；显式传 null = 清空（无特化）。 */
  spec?: string | null
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
