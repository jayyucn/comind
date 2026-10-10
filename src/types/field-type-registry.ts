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
  | 'number'    // 数字输入
  | 'boolean'   // 布尔（勾选 / 是否单选）
  | 'date'      // 日期选择（yyyy-MM-dd）
  | 'datetime'  // 日期时间选择（yyyy-MM-dd HH:mm）
  | 'enum'      // 封闭枚举单选（closedValues / options）
  | 'multiEnum' // 封闭枚举多选
  | 'tags'      // 标签数组（自由输入 + chips）
  | 'pageRef'   // 页面引用选择

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
const SELECT_OPS: readonly FilterOp[] = ['is', 'isNot', 'isEmpty', 'isNotEmpty']
const MULTI_SELECT_OPS: readonly FilterOp[] = ['contains', 'notContains', 'hasAll', 'isEmpty', 'isNotEmpty']

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
  select:     { editor: 'enum',     displayForm: 'chip', filterOps: SELECT_OPS },
  multiSelect:{ editor: 'multiEnum',displayForm: 'chip', filterOps: MULTI_SELECT_OPS },
  // array（标签数组）与 page（页面引用）沿用既有语义：前者多选操作符，后者文本操作符
  array:      { editor: 'tags',     displayForm: 'chip', filterOps: MULTI_SELECT_OPS },
  page:       { editor: 'pageRef',  displayForm: 'chip', filterOps: TEXT_OPS },
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
