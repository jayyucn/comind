/**
 * 字段类型中央注册表（issue #140 F1）——类型 → { 编辑器, 展示形态, 过滤操作符 } 单源查表。
 *
 * 规范联合 FieldType 以领域层词汇为基准（`types/field-definition.ts` 单源定义，
 * 查询引擎层 re-export）。此前三处散表——查询层 `operators.ts` 的 DEFAULT_OPS、
 * 展示层 `field-display-form.ts` 的 typeDefaultForm、桥接层 `useBlockQueryRegistry.ts`
 * 的 TYPE_MAP——均收编为本表的消费方，消除「枚举在领域层叫 string+closedValues、
 * 查询层叫 select/multiSelect」的词汇错位。
 *
 * 本模块 headless：editor 只发 token（字符串联合），组件分派由 UI 层消费 token 完成。
 * 未知类型保守回落（text 编辑器 / text 形态 / 空操作符）——与旧 deriveOps 语义一致，
 * v1 引擎不认识的类型不可筛。
 *
 * 依赖方向：对 `core/query/types`（FilterOp）与 `utils/field-display-form`
 * （DisplayFormKind）均为 **type-only** import（编译期擦除），运行时依赖图是
 * 单向 DAG——field-display-form → 本表，本表不反向依赖任何运行时模块。
 */
import type { FilterOp } from '../core/query/types'
import type { DisplayFormKind } from '../utils/field-display-form'
import type { FieldType } from './field-definition'

/** 编辑器 token：UI 层（FieldValueEditor / BlockFieldZone / ValueEditor 等）据 token 分派组件。 */
export type FieldEditorKind =
  | 'text'      // 单行文本
  | 'multiline' // 多行文本（string 特化 richtext，issue T6）
  | 'number'    // 数字输入
  | 'boolean'   // 布尔（勾选 / 是否单选）
  | 'date'      // 日期选择（yyyy-MM-dd）
  | 'datetime'  // 日期时间选择（yyyy-MM-dd HH:mm）
  | 'daterange' // 日期区间选择（起止两日期，yyyy-MM-dd 两端；issue T8）
  | 'enum'      // 封闭枚举单选（closedValues / options）
  | 'multiEnum' // 封闭枚举多选
  | 'tags'      // 标签数组（自由输入 + chips）
  | 'pageRef'   // 页面引用选择
  | 'personRef' // 页面引用特化 person（负责人）：候选限定 person 页，人员 chip 展示（issue T10）
  | 'rating'    // 评分 1–N 星（number 特化 rating，issue T7）
  | 'file'      // 附件（上传文件，引用路径落库；issue T9）
  | 'relation'  // 关系引用（目标块/页 + 关系类型；issue T5）

/** 单个字段类型的三面规格。 */
export interface FieldTypeSpec {
  /** 编辑器 token（headless：此处只定 token，不引组件）。 */
  editor: FieldEditorKind
  /** 默认展示形态（D21 决策 1 的类型默认映射；用户 display_form_override 在解析层覆盖）。 */
  displayForm: DisplayFormKind
  /** 默认过滤操作符集（旧「操作符派生表」；字段级 ops 可覆盖）。 */
  filterOps: readonly FilterOp[]
}

const TEXT_OPS: readonly FilterOp[] = ['is', 'isNot', 'contains', 'notContains', 'isEmpty', 'isNotEmpty']
const NUMBER_OPS: readonly FilterOp[] = ['eq', 'neq', 'gt', 'lt', 'isEmpty', 'isNotEmpty']
const DATE_OPS: readonly FilterOp[] = ['before', 'after', 'between', 'within', 'isEmpty', 'isNotEmpty']
// datetime（yyyy-MM-dd HH:mm）：只有 before/after 语义正确——值对 day 目标
// 「早于=严格早于该天 / 晚于=该天及之后」；between/within 的闭区间会漏掉同日记录
// （'2026-09-06 10:44' <= '2026-09-06' 为 false），故不开放。
const DATETIME_OPS: readonly FilterOp[] = ['before', 'after', 'isEmpty', 'isNotEmpty']
// daterange（日期区间，issue T8）：值形 { start, end }，语义针对**区间整体**——
// before = 区间整体早于参照日（end < 参照，严格小于：end == 参照日不算整体早于）；
// after  = 区间整体晚于参照日（start > 参照，严格大于）。
// between/within 涉及「区间与参照范围相交」的语义，v1 不开放。
const DATERANGE_OPS: readonly FilterOp[] = ['before', 'after', 'isEmpty', 'isNotEmpty']
const SELECT_OPS: readonly FilterOp[] = ['is', 'isNot', 'isEmpty', 'isNotEmpty']
const MULTI_SELECT_OPS: readonly FilterOp[] = ['contains', 'notContains', 'hasAny', 'hasAll', 'isEmpty', 'isNotEmpty']

/**
 * 中央注册表：规范联合全量成员 → 三面规格。
 * 键穷举 FieldType（少一个成员 TS 即报错），保证新增类型必须补全三面。
 */
export const FIELD_TYPE_REGISTRY: Readonly<Record<FieldType, FieldTypeSpec>> = {
  string:     { editor: 'text',     displayForm: 'text', filterOps: TEXT_OPS },
  number:     { editor: 'number',   displayForm: 'chip', filterOps: NUMBER_OPS },
  boolean:    { editor: 'boolean',  displayForm: 'icon', filterOps: ['is'] },
  date:       { editor: 'date',     displayForm: 'chip', filterOps: DATE_OPS },
  datetime:   { editor: 'datetime', displayForm: 'chip', filterOps: DATETIME_OPS },
  daterange:  { editor: 'daterange',displayForm: 'chip', filterOps: DATERANGE_OPS },
  select:     { editor: 'enum',     displayForm: 'chip', filterOps: SELECT_OPS },
  multiSelect:{ editor: 'multiEnum',displayForm: 'chip', filterOps: MULTI_SELECT_OPS },
  // array（标签数组）与 page（页面引用）沿用既有语义：前者多选操作符，后者文本操作符
  array:      { editor: 'tags',     displayForm: 'chip', filterOps: MULTI_SELECT_OPS },
  page:       { editor: 'pageRef',  displayForm: 'chip', filterOps: TEXT_OPS },
  // file（附件，issue T9）：contains 作用于文件名；值形 { path, name, mime? } 走 JSON 编解码
  file:       { editor: 'file',     displayForm: 'chip', filterOps: ['contains', 'isEmpty', 'isNotEmpty'] },
  // relation（关系引用，issue T5）：值形 { targetId, relationshipTypeId } 走 JSON 编解码；
  // v1 只开放「有没有值」的筛法（目标/关系类型的值级匹配留待查询引擎跟进）
  relation:   { editor: 'relation', displayForm: 'chip', filterOps: ['isEmpty', 'isNotEmpty'] },
}

/** 未知类型保守回落（v1 不认识即不可筛）。 */
const FALLBACK_SPEC: FieldTypeSpec = { editor: 'text', displayForm: 'text', filterOps: [] }

/**
 * 按类型查三面规格。规范类型查表；未知类型（自定义/未来扩展）回落保守规格。
 * 返回的 filterOps 是副本，调用方改动不影响注册表。
 */
export function fieldTypeSpec(type: string): FieldTypeSpec {
  const spec = (FIELD_TYPE_REGISTRY as Record<string, FieldTypeSpec | undefined>)[type] ?? FALLBACK_SPEC
  return { ...spec, filterOps: [...spec.filterOps] }
}

// ── string 特化族（issue T6）：email / phone / url / richtext ─────────────
//
// 底层类型仍是 'string'（不扩 FieldType 联合），靠 FieldDefinition.spec 标记分派。
// 键为开放 string：其他类型的特化（如 number 特化，T7）复用同一查表与同一 spec
// 标记位，往 STRING_SPECIALIZATIONS 追加键即可；未知 spec 返回 undefined，
// 调用方回落原类型路径（零回归）。

/** string 特化的三面 + 可选格式校验。 */
export interface StringSpecializationSpec {
  /** 编辑器 token（richtext → 'multiline'；email/phone/url 仍走 'text'）。 */
  editor: FieldEditorKind
  /** 展示形态（url → chip 带链接；其余 → text）。 */
  displayForm: DisplayFormKind
  /**
   * 可选格式校验：null = 合法；返回错误文案（UI 红字提示且阻止落库）。
   * 空串视为未填，恒合法（删行语义由上层处理）。
   */
  validate?(v: string): string | null
}

/** 宽松实用正则：常规邮箱（x@y.z）。 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** 宽松实用正则：数字 / + / - / 空格，7-20 位。 */
const PHONE_RE = /^[+\d][\d\s-]{6,19}$/

/**
 * string 特化查表：spec 名 → 三面规格。封闭只读；T7 等后续特化往此追加键。
 */
export const STRING_SPECIALIZATIONS: Readonly<Record<string, StringSpecializationSpec>> = {
  email: {
    editor: 'text',
    displayForm: 'text',
    validate: (v) => (v.trim() === '' || EMAIL_RE.test(v.trim()) ? null : '邮箱格式不正确'),
  },
  phone: {
    editor: 'text',
    displayForm: 'text',
    validate: (v) => (v.trim() === '' || PHONE_RE.test(v.trim()) ? null : '电话格式不正确'),
  },
  url: { editor: 'text', displayForm: 'chip' },
  richtext: { editor: 'multiline', displayForm: 'text' },
}

/**
 * 特化标记首段（剥 `name:params` 的参数后缀）——三个特化族查表与全部 UI 消费方
 * 共用的单源解析（code-review Standards#2：原先 7 处各自 split，已收编）。
 */
export function specHeadOf(spec: string | null | undefined): string {
  return (spec ?? '').split(':')[0] ?? ''
}

/**
 * 按特化标记查 string 特化规格。无标记 / 未知标记 → undefined（调用方走原路径）。
 * 参数化标记（`name:params`，与 T7 numberSpecialization 同约定）取冒号前首段命中。
 */
export function stringSpecialization(spec?: string | null): StringSpecializationSpec | undefined {
  if (!spec) return undefined
  return (STRING_SPECIALIZATIONS as Record<string, StringSpecializationSpec | undefined>)[specHeadOf(spec)]
}

// ── number 特化族（issue T7）：currency / percent / rating ────────────────
//
// 与 string 特化族（T6）同构：底层类型仍是 'number'（不扩 FieldType 联合），
// 靠 FieldDefinition.spec 标记分派。currency / percent 编辑仍走 number 编辑器
// （展示特化）；rating 换 'rating' 星级编辑器。未知 spec → undefined，
// 调用方回落原 number 路径（零回归）。

/** number 特化的编辑器 / 展示形态二面（过滤操作符沿用 number 的 NUMBER_OPS，不特化）。 */
export interface NumberSpecializationSpec {
  editor: FieldEditorKind
  displayForm: DisplayFormKind
}

/** number 特化查表：spec 名 → 二面规格。封闭只读。 */
export const NUMBER_SPECIALIZATIONS: Readonly<Record<string, NumberSpecializationSpec>> = {
  currency: { editor: 'number', displayForm: 'chip' },
  percent:  { editor: 'number', displayForm: 'chip' },
  rating:   { editor: 'rating', displayForm: 'chip' },
}

/**
 * 按特化标记查 number 特化规格。无标记 / 未知标记 → undefined（调用方走原路径）。
 * 注意 currency spec 可带符号/单位后缀（如 'currency:¥/元'，解析单源
 * `utils/field-number-format.parseCurrencySpec`），查表前先取首段。
 */
export function numberSpecialization(spec?: string | null): NumberSpecializationSpec | undefined {
  if (!spec) return undefined
  return (NUMBER_SPECIALIZATIONS as Record<string, NumberSpecializationSpec | undefined>)[specHeadOf(spec)]
}

// ── page 特化族（issue T10）：person（负责人）─────────────────────────────
//
// 与 string（T6）/ number（T7）特化族同构：底层类型仍是 'page'（不扩 FieldType
// 联合），靠 FieldDefinition.spec 标记分派。person 编辑换 'personRef'（候选限定
// person 页的引用 picker），展示仍 chip（人员样式 chip 由 UI 层叠加）。未知 spec
// → undefined，调用方回落原 page 路径（零回归）。

/** page 特化的编辑器 / 展示形态二面（过滤操作符沿用 page 的 TEXT_OPS，不特化）。 */
export interface PageSpecializationSpec {
  editor: FieldEditorKind
  displayForm: DisplayFormKind
}

/** page 特化查表：spec 名 → 二面规格。封闭只读。 */
export const PAGE_SPECIALIZATIONS: Readonly<Record<string, PageSpecializationSpec>> = {
  person: { editor: 'personRef', displayForm: 'chip' },
}

/**
 * 按特化标记查 page 特化规格。无标记 / 未知标记 → undefined（调用方走原路径）。
 * 参数化标记（`name:params`，与 T7 numberSpecialization 同约定）取冒号前首段命中。
 */
export function pageSpecialization(spec?: string | null): PageSpecializationSpec | undefined {
  if (!spec) return undefined
  return (PAGE_SPECIALIZATIONS as Record<string, PageSpecializationSpec | undefined>)[specHeadOf(spec)]
}
