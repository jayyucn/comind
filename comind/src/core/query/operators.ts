/**
 * 操作符派生表 —— 无头核心，纯 TS，不依赖 Vue / Pinia。
 *
 * 把字段类型映射到该类型支持的默认操作符集（设计文档「操作符派生表」）。
 * 字段可用 {@link FieldDescriptor.ops} 覆盖或扩展默认集。求值器与 FilterBuilder
 * 的操作符选择器共用 {@link deriveOps} 这一唯一入口。
 */
import type { FieldDescriptor, FilterOp } from './types'

/** 各内置类型默认操作符集（设计文档「操作符派生表」表格）。 */
export const DEFAULT_OPS: Record<string, FilterOp[]> = {
  text: ['is', 'isNot', 'contains', 'notContains', 'isEmpty', 'isNotEmpty'],
  number: ['eq', 'neq', 'gt', 'lt', 'isEmpty', 'isNotEmpty'],
  date: ['before', 'after', 'between', 'isEmpty', 'isNotEmpty'],
  select: ['is', 'isNot', 'isEmpty', 'isNotEmpty'],
  multiSelect: ['hasAny', 'hasAll', 'isEmpty', 'isNotEmpty'],
  boolean: ['is'],
}

/**
 * 派生字段可用操作符集。
 *
 * - 字段声明了 `ops`：以覆盖为准（可扩展或缩减默认集）。
 * - 否则取类型默认集。
 * - 自定义类型（不在 {@link DEFAULT_OPS} 中）且未声明 `ops`：返回空数组，
 *   v1 引擎不认识该类型，交由调用方决定（通常该字段尚不可筛选）。
 *
 * 返回的是副本，调用方改动不影响内部映射。
 */
export function deriveOps(descriptor: FieldDescriptor): FilterOp[] {
  return [...(descriptor.ops ?? DEFAULT_OPS[descriptor.type] ?? [])]
}
