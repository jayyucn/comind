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
 * 本工单（#17）范围：单组（children 视为 Condition 叶子）+ AND/OR + text/select。
 * 嵌套条件组与组级 negate 由 #18 扩展 evalGroup；其余字段类型由 #19；排序/分组由 #20。
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

/** 单条件匹配。调用方（evalGroup）保证传入的是 Condition 叶子，而非嵌套组。 */
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
    default:
      // v1 仅实现 text/select；其余操作符（number/date/multiSelect）由 #19 补齐
      return false
  }
}

/** 单个条件组求值：空组 = 无筛选（全部通过）；and/or 组合子结果。组级 negate 由 #18 加入。 */
export function evalGroup(
  group: ConditionGroup,
  item: unknown,
  registry: Registry,
  entityType: string,
): boolean {
  if (group.children.length === 0) return true
  const results = group.children.map((child) => {
    // v1：嵌套组（含 children）按非匹配处理，由 #18 扩展为递归求值
    if ('children' in child) return false
    return matchCondition(child, item, registry, entityType)
  })
  return group.combinator === 'and' ? results.every(Boolean) : results.some(Boolean)
}

/**
 * 求值入口：对 items 全量过滤，返回原集合的子集（不修改入参）。
 * v1 仅应用筛选；排序/分组由 #20 扩展本函数。纯函数，重算交给调用方缓存。
 */
export function evaluate<T>(query: ViewQuery, items: T[], registry: Registry, entityType: string): T[] {
  return items.filter((item) => evalGroup(query.filter, item, registry, entityType))
}
