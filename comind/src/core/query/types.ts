/**
 * 通用查询引擎 —— 无头核心类型定义（不依赖 Vue / Pinia）。
 *
 * 业务实体通过声明 {@link FieldDescriptor} 接入引擎，引擎对实体本身一无所知。
 * 详细设计见 docs/2-architecture/generic-query-system.md。
 */

/** 内置字段数据类型。v1 引擎仅实现这六种；`(string & {})` 使联合保持开放，允许后续自定义类型（不丢失字面量提示）。 */
export type FieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'select'
  | 'multiSelect'
  | 'boolean'
  | (string & {})

/** select / multiSelect 字段的选项。查询值存 id 而非 label。 */
export interface Option {
  id: string
  label: string
}

/** 可筛选字段支持的操作符。具体可用集由类型派生，字段可用 ops 覆盖。boolean 复用 `is`。 */
export type FilterOp =
  // text
  | 'is' | 'isNot' | 'contains' | 'notContains'
  // date
  | 'before' | 'after' | 'between'
  // number
  | 'eq' | 'neq' | 'gt' | 'lt'
  // multiSelect
  | 'hasAny' | 'hasAll'
  // 空值（所有类型通用）
  | 'isEmpty' | 'isNotEmpty'
  // boolean
  | 'is'

/**
 * 字段描述符：业务实体接入引擎的唯一契约。
 *
 * @typeParam T - 被筛选的实体项类型。
 */
export interface FieldDescriptor<T = unknown> {
  /** 字段唯一标识（同一 entityType 命名空间内唯一）。Condition.field 引用它。 */
  key: string
  /** UI 展示用标签。 */
  label: string
  /** 数据类型，决定默认操作符集与值编辑器。 */
  type: FieldType
  /** 同步取值器，支持派生计算字段。返回 undefined/null 视为空值。 */
  get: (item: T) => unknown
  /** 可选：覆盖由类型派生的操作符集。 */
  ops?: FilterOp[]
  /** select / multiSelect 专用：静态数组或同步 provider。 */
  options?: Option[] | (() => Option[])
  /** date 字段参与分组时的分桶粒度。 */
  dateBucket?: 'day' | 'week' | 'month'
  /** 可选：为未来 SQL 下推预留的属性路径。 */
  path?: string
}

/**
 * 条件值的判别联合（字段引用值特性）。
 *
 * - `literal`：字面量值（与旧版 `value` 等价，JSON 直接存）。
 * - `field`：同记录字段引用——求值时取 `registry.get(entityType, field).get(item)`，
 *   实现「字段间比较」（如「字数 > 子页面数」）。
 * - `pageField`：跨记录字段引用——取指定 Page（pageId）的某字段值作比较目标。
 *   求值需 {@link QueryContext.getById} 提供按 id 取 Page 的能力；不提供时一律非匹配。
 *
 * 序列化：三者皆为纯 JSON 对象，随 ViewQuery 直接 JSON 往返；旧版裸字面量由
 * `parseQuery` 自动包裹为 `literal`（向前兼容）。
 */
export type ConditionValue =
  | { kind: 'literal'; value: unknown }
  | { kind: 'field'; field: string }
  | { kind: 'pageField'; pageId: string; field: string }

/** 单个筛选条件。 */
export interface Condition {
  /** FieldDescriptor.key（被比较的字段）。 */
  field: string
  op: FilterOp
  /** 比较目标值；isEmpty / isNotEmpty 无 value。 */
  value?: ConditionValue
}

/**
 * 求值上下文：跨记录字段引用（pageField）解析所需的可选能力。
 * getById 按 entityType + id 取实体对象；不提供时 pageField 一律非匹配。
 */
export interface QueryContext {
  getById?: (entityType: string, id: string) => unknown | undefined
}

/** 条件组：可嵌套，构成 AND/OR 组合树。扁平条件列表是其退化形态（单 and 根组，children 全为 Condition）。 */
export interface ConditionGroup {
  combinator: 'and' | 'or'
  /** 组级取反，默认 false；参与序列化，v1 通用 UI 不暴露。 */
  negate?: boolean
  children: (Condition | ConditionGroup)[]
}

/** 排序规则，按数组顺序构成多键排序。 */
export interface SortRule {
  field: string
  dir: 'asc' | 'desc'
}

/** 视图查询：筛选 + 多键排序 + 单字段分组。整体为可序列化纯数据，带 version。 */
export interface ViewQuery {
  version: 1
  /** 根条件组；空 children 表示无筛选。 */
  filter: ConditionGroup
  sort: SortRule[]
  /** 单字段分组，值为 FieldDescriptor.key；null 表示不分组。 */
  groupBy: string | null
}
