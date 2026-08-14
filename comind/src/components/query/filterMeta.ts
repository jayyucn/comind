/**
 * 筛选芯片文案与摘要工具（ADR-0009）。
 *
 * 纯函数，无 Vue 依赖；供 ConditionPopover（字段/操作符下拉标签）与 FilterChip
 * （条件摘要文本）共用，避免重复派生逻辑。操作符中文标签与 ADR「操作符派生表」
 * 及现有 FilterBuilder 用词保持一致。
 */
import type { Condition, FieldDescriptor, FilterOp } from '../../core/query'
import { deriveOps } from '../../core/query'

/** 操作符 → 中文标签。boolean 的 `is` 与 text 的 `is` 同词「是」。 */
export const OP_LABELS: Record<FilterOp, string> = {
  is: '是',
  isNot: '不是',
  contains: '包含',
  notContains: '不包含',
  before: '早于',
  after: '晚于',
  between: '介于',
  eq: '等于',
  neq: '不等于',
  gt: '大于',
  lt: '小于',
  hasAny: '含任一',
  hasAll: '含全部',
  isEmpty: '为空',
  isNotEmpty: '不为空',
}

export function opLabel(op: FilterOp): string {
  return OP_LABELS[op] ?? op
}

/** 取字段的默认操作符（派生表首个）。 */
export function defaultOpFor(field: FieldDescriptor): FilterOp {
  const ops = deriveOps(field)
  return ops.length ? ops[0] : 'is'
}

/** 选项 id → label（select / multiSelect）。 */
function optionLabel(field: FieldDescriptor, id: string): string {
  const opts = typeof field.options === 'function' ? field.options() : field.options ?? []
  return opts.find((o) => o.id === id)?.label ?? id
}

/** 把字面量值格式化为可读文本（between 为区间，multiSelect 为标签列表）。 */
export function formatLiteral(field: FieldDescriptor, value: unknown): string {
  if (value === undefined || value === null || value === '') return ''
  if (Array.isArray(value)) {
    if (field.type === 'date') {
      const [from, to] = value as [string, string]
      return `${from || '…'} ~ ${to || '…'}`
    }
    return (value as string[]).map((id) => optionLabel(field, id)).join('、')
  }
  if (field.type === 'boolean') return value === true ? '是' : '否'
  if (field.type === 'select') return optionLabel(field, String(value))
  return String(value)
}

/** 条件摘要：「字段 操作符 值」；空值操作符仅「字段 操作符」。 */
export function summarizeCondition(field: FieldDescriptor, cond: Condition): string {
  const op = opLabel(cond.op)
  if (cond.op === 'isEmpty' || cond.op === 'isNotEmpty') return `${field.label} ${op}`
  const literal = cond.value?.kind === 'literal' ? cond.value.value : undefined
  const valText = formatLiteral(field, literal)
  return valText ? `${field.label} ${op} ${valText}` : `${field.label} ${op}`
}
