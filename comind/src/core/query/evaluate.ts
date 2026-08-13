/**
 * 求值器 v1 —— 无头核心，纯 TS，不依赖 Vue / Pinia。
 *
 * 对单个 Condition Group 按 and/or 组合条件求值，落地 text 与 select 两种字段类型
 * 的操作符，并确立贯穿全局的空值语义（设计文档「空值语义」一节）：
 * - getter 返回 undefined / null 即视为空
 * - 比较类操作符遇空一律返回 false
 * - 只有 isEmpty / isNotEmpty 关心空值
 * - select 引用已删除选项 id 时，条件降级为非匹配
 *
 * 本文件覆盖：单/嵌套条件组递归求值（#17 单组 + #18 嵌套/negate）、text 与 select 操作符（#17）、
 * 空值语义（#17）。其余字段类型由 #19 补齐；排序/分组由 #20 扩展 evaluate。
 */
import type { Condition, ConditionGroup, FieldDescriptor, ViewQuery } from './types'
import type { Registry } from './registry'

/** 归一化空值：undefined / null 一律折叠为 undefined。 */
function normalize(value: unknown): unknown {
  return value === undefined || value === null ? undefined : value
}

/** 取字段静态/动态选项 id 集合；字段未声明 options 时返回 null。 */
function optionIds(descriptor: FieldDescriptor<unknown>): Set<string> | null {
  const opts = descriptor.options
  if (!opts) return null
  const list = typeof opts === 'function' ? opts() : opts
  return new Set(list.map((o) => o.id))
}

/** 标量相等比较：统一按字符串比对，兼容数字型 id。 */
function eqScalars(a: unknown, b: unknown): boolean {
  return String(a) === String(b)
}

/** 单条件匹配。仅处理 Condition 叶子；嵌套组由 evalGroup 递归求值。 */
export function matchCondition(
  cond: Condition,
  item: unknown,
  registry: Registry,
  entityType: string,
): boolean {
  const descriptor = registry.get(entityType, cond.field) as FieldDescriptor<unknown> | undefined
  if (!descriptor) return false

  const value = normalize(descriptor.get(item))
  const op = cond.op

  // 空值专属操作符
  if (op === 'isEmpty') return value === undefined
  if (op === 'isNotEmpty') return value !== undefined

  // 比较类操作符遇空即 false
  if (value === undefined) return false

  // select / multiSelect：条件引用的选项 id 已不在字段当前选项集合 → 降级为非匹配
  const ids = optionIds(descriptor)
  if (ids && (op === 'is' || op === 'isNot') && !ids.has(String(cond.value))) {
    return false
  }

  switch (op) {
    case 'is':
      return eqScalars(value, cond.value)
    case 'isNot':
      return !eqScalars(value, cond.value)
    case 'contains':
      return String(value)
        .toLowerCase()
        .includes(String(cond.value ?? '').toLowerCase())
    case 'notContains':
      return !String(value)
        .toLowerCase()
        .includes(String(cond.value ?? '').toLowerCase())
    // number
    case 'eq':
      return Number(value) === Number(cond.value)
    case 'neq':
      return Number(value) !== Number(cond.value)
    case 'gt':
      return Number(value) > Number(cond.value)
    case 'lt':
      return Number(value) < Number(cond.value)
    // date：日粒度，yyyy-MM-dd 字符串比较即可正确排序
    case 'before':
      return String(value) < String(cond.value)
    case 'after':
      return String(value) > String(cond.value)
    case 'between': {
      const [from, to] = Array.isArray(cond.value) ? cond.value : [cond.value, cond.value]
      const s = String(value)
      return s >= String(from) && s <= String(to)
    }
    // multiSelect：item 值为已选 id 数组
    case 'hasAny':
    case 'hasAll': {
      const selected = Array.isArray(value) ? (value as unknown[]) : []
      let targets = Array.isArray(cond.value) ? (cond.value as unknown[]) : [cond.value]
      // 删除选项降级：引用的 id 已不在字段当前选项集合 → 过滤掉；全部被删则非匹配
      if (ids) {
        targets = targets.filter((t) => ids.has(String(t)))
        if (targets.length === 0) return false
      }
      const selectedSet = new Set(selected.map(String))
      return op === 'hasAny'
        ? targets.some((t) => selectedSet.has(String(t)))
        : targets.every((t) => selectedSet.has(String(t)))
    }
    default:
      return false
  }
}

/**
 * 条件组求值：递归支持任意嵌套的 AND/OR 组合树。
 * - 空 children 的组 = 无筛选（全部通过），与 ViewQuery.filter 空组语义一致。
 * - children 中的 Condition 走 matchCondition；ConditionGroup 递归本函数。
 * - 组级 negate 对整个子结果取反（默认 false）。
 */
export function evalGroup(
  group: ConditionGroup,
  item: unknown,
  registry: Registry,
  entityType: string,
): boolean {
  if (group.children.length === 0) return true
  const results = group.children.map((child) =>
    'children' in child
      ? evalGroup(child, item, registry, entityType)
      : matchCondition(child, item, registry, entityType),
  )
  const combined = group.combinator === 'and' ? results.every(Boolean) : results.some(Boolean)
  return group.negate ? !combined : combined
}

/**
 * 求值入口：对 items 全量过滤，返回原集合的子集（不修改入参）。
 * v1 仅应用筛选；排序/分组由 #20 扩展本函数。纯函数，重算交给调用方缓存。
 */
export function evaluate<T>(query: ViewQuery, items: T[], registry: Registry, entityType: string): T[] {
  return items.filter((item) => evalGroup(query.filter, item, registry, entityType))
}
