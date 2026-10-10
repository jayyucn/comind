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
 * - daterange：日期区间（单字段存起止两日期，值形 { start, end }，yyyy-MM-dd 两端；issue T8）
 * - file：附件（上传文件，引用路径落库，值形 { path, name, mime? }；issue T9）
 * - relation：块/页级关系引用（issue T5）——值域 RelationRefValue（目标 id + 关系类型
 *   id），落库为 JSON 对象（codec 走默认 JSON 路径，同 multiSelect）；字段定义经
 *   closed_values 携带约定的关系类型 id（单元素数组，最小持久化路径，见 tag-persisted.ts）
 * - array / page / boolean / string / number / date：既有词汇，保持不变
 */
export type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'daterange'
  | 'select'
  | 'multiSelect'
  | 'array'
  | 'page'
  | 'file'
  | 'relation'

/** file 字段的内存值形态（issue T9）：path 为资产引用（`asset://<id>`，跟随既有
 *  workspace/assets/ 资产目录约定），name 为原始文件名（展示用），mime 可选。 */
export interface FileRefValue {
  path: string
  name: string
  mime?: string
}

/**
 * relation 字段值域（issue T5）：目标块/页 id + 关系类型 id（relationship_type 领域
 * 模型见 types/relationship-type.ts，清单服务见 composables/useRelationshipTypes.ts）。
 * 落库形态 = 本对象的 JSON 文本（value_value → value_json），编解码单源在
 * field-value-codec（relation 不在 PLAIN_TYPES，走默认 JSON 路径，同 multiSelect）。
 */
export interface RelationRefValue {
  targetId: string
  relationshipTypeId: string
}

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

  /**
   * 特化标记（issue T6）：type==='string' 时的特化种类 'email' | 'phone' | 'url' |
   * 'richtext'。开放 string——同一字段机制供其他类型复用（如 number 特化，T7），
   * 未知 / 缺省 = 无特化，走原类型路径（零回归）。分派单源：
   * `field-type-registry.stringSpecialization(spec)`。
   */
  spec?: string
}

/**
 * 字段值域映射（类型安全）。datetime / select 值为字符串（后者存选项 id），
 * multiSelect 值为选项 id 数组，daterange 值为起止两日期（内存对象形态，
 * 两端均为 yyyy-MM-dd；undefined = 未填 = 删行契约，与 date 同口径）。
 */
export type FieldValueDataMap = {
  string: string
  number: number
  boolean: boolean
  date: string
  datetime: string
  daterange: { start: string; end: string }
  select: string
  multiSelect: string[]
  array: string[]
  page: string
  file: FileRefValue
  /** relation（issue T5）：目标 + 关系类型引用对象 */
  relation: RelationRefValue
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
