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
 * 本文件覆盖：单/嵌套条件组递归求值（#17 单组 + #18 嵌套/negate）、六种内置类型全部操作符
 * （#17 text/select + #19 number/date/multiSelect/boolean）、空值语义（#17）、多键排序与单字段分组
 *（#20，sortItems / groupItems 与求值解耦、可独立单测）。
 */
import type { Condition, ConditionGroup, ConditionValue, FieldDescriptor, QueryContext, SortRule, ViewQuery } from './types'
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

/**
 * 把 {@link ConditionValue} 解析为「比较目标值」。
 *
 * - literal：原值。
 * - field：取同记录另一字段的值（字段间比较）。
 * - recordRef：经 context.getById 取出目标实体（cv.entityType + cv.recordId），再取其字段值；取不到目标或字段则 undefined（非匹配）。
 */
function resolveTarget(
  cv: ConditionValue | undefined,
  item: unknown,
  registry: Registry,
  entityType: string,
  context?: QueryContext,
): unknown {
  if (!cv) return undefined
  switch (cv.kind) {
    case 'literal':
      return cv.value
    case 'field': {
      const d = registry.get(entityType, cv.field)
      return d ? d.get(item) : undefined
    }
    case 'recordRef': {
      const targetItem = context?.getById?.(cv.entityType, cv.recordId)
      if (targetItem === undefined) return undefined
      const d = registry.get(cv.entityType, cv.field)
      return d ? d.get(targetItem) : undefined
    }
    default:
      return undefined
  }
}

/** 单条件匹配。仅处理 Condition 叶子；嵌套组由 evalGroup 递归求值。 */
export function matchCondition(
  cond: Condition,
  item: unknown,
  registry: Registry,
  entityType: string,
  context?: QueryContext,
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

  const cv = cond.value
  if (!cv) return false

  // 解析比较目标值（字面量 / 同记录字段 / 跨记录引用字段）
  const targetRaw = resolveTarget(cv, item, registry, entityType, context)
  const target = normalize(targetRaw)
  // 目标为空（含字面量空值、字段为空、Page 未取到）→ 无法比较，非匹配
  if (target === undefined) return false

  // select / multiSelect：仅「字面量」引用的选项 id 已不在字段当前选项集合 → 降级为非匹配。
  // 字段引用（field / recordRef）为动态值，不降级。
  const ids = optionIds(descriptor)
  if (ids && cv.kind === 'literal' && (op === 'is' || op === 'isNot') && !ids.has(String(target))) {
    return false
  }

  switch (op) {
    case 'is':
      return eqScalars(value, target)
    case 'isNot':
      return !eqScalars(value, target)
    case 'contains': {
      // multiSelect：选中集合含任一目标即匹配；text：子串包含
      const selected = Array.isArray(value) ? (value as unknown[]) : null
      if (selected) {
        let targets = Array.isArray(targetRaw) ? (targetRaw as unknown[]) : [targetRaw]
        if (ids) targets = targets.filter((t) => ids.has(String(t)))
        const set = new Set(selected.map(String))
        return targets.some((t) => set.has(String(t)))
      }
      const tgt = String(target ?? '').toLowerCase()
      return String(value).toLowerCase().includes(tgt)
    }
    case 'notContains': {
      const selected = Array.isArray(value) ? (value as unknown[]) : null
      if (selected) {
        let targets = Array.isArray(targetRaw) ? (targetRaw as unknown[]) : [targetRaw]
        if (ids) targets = targets.filter((t) => ids.has(String(t)))
        const set = new Set(selected.map(String))
        return !targets.some((t) => set.has(String(t)))
      }
      const tgt = String(target ?? '').toLowerCase()
      return !String(value).toLowerCase().includes(tgt)
    }
    // number
    case 'eq':
      return Number(value) === Number(target)
    case 'neq':
      return Number(value) !== Number(target)
    case 'gt':
      return Number(value) > Number(target)
    case 'lt':
      return Number(value) < Number(target)
    // date：日粒度，yyyy-MM-dd 字符串比较即可正确排序
    case 'before':
      return String(value) < String(target)
    case 'after':
      return String(value) > String(target)
    case 'between': {
      const [from, to] = Array.isArray(targetRaw) ? (targetRaw as [unknown, unknown]) : [targetRaw, targetRaw]
      const s = String(value)
      return s >= String(from) && s <= String(to)
    }
    // date：相对范围（本周内/本月内等），值形态同 between 的 [from, to] 闭区间
    case 'within': {
      const [from, to] = Array.isArray(targetRaw) ? (targetRaw as [unknown, unknown]) : [targetRaw, targetRaw]
      const s = String(value)
      return s >= String(from) && s <= String(to)
    }
    // multiSelect：item 值为已选 id 数组
    case 'hasAny':
    case 'hasAll': {
      const selected = Array.isArray(value) ? (value as unknown[]) : []
      let targets = Array.isArray(targetRaw) ? (targetRaw as unknown[]) : [targetRaw]
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
  context?: QueryContext,
): boolean {
  if (group.children.length === 0) return true
  const results = group.children.map((child) =>
    'children' in child
      ? evalGroup(child, item, registry, entityType, context)
      : matchCondition(child, item, registry, entityType, context),
  )
  const combined = group.combinator === 'and' ? results.every(Boolean) : results.some(Boolean)
  return group.negate ? !combined : combined
}

/** 排序/分组结果桶。 */
export interface Group<T> {
  /** 桶键：select 为选项 id，date 为分桶键，其余为值字符串，空值为 ''。 */
  key: string
  /** 桶展示标签。 */
  label: string
  items: T[]
}

/** 比较两个排序键值：空值（undefined）始终排在末尾，与 asc/desc 无关。 */
function compareValues(a: unknown, b: unknown): number {
  if (a === undefined && b === undefined) return 0
  if (a === undefined) return 1
  if (b === undefined) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

/**
 * 多键稳定排序：sort 数组按序逐级回退；空值恒排末尾（asc/desc 皆然）。
 * 纯函数，返回新数组，不修改入参。
 */
export function sortItems<T>(items: T[], sort: SortRule[], registry: Registry, entityType: string): T[] {
  if (sort.length === 0) return items
  const keyed = items.map((item) => ({
    item,
    keys: sort.map((rule) => {
      const descriptor = registry.get(entityType, rule.field)
      return descriptor ? normalize(descriptor.get(item)) : undefined
    }),
  }))
  return keyed
    .sort((x, y) => {
      for (let i = 0; i < sort.length; i++) {
        const cmp = compareValues(x.keys[i], y.keys[i])
        if (cmp !== 0) return sort[i].dir === 'desc' ? -cmp : cmp
      }
      return 0
    })
    .map((k) => k.item)
}

/** date 按 day / week / month 分桶键（week 取周一）。 */
function dateBucketKey(dateStr: string, gran: 'day' | 'week' | 'month'): string {
  if (!dateStr) return ''
  const d = new Date(`${dateStr}T00:00:00`)
  if (isNaN(d.getTime())) return dateStr
  if (gran === 'day') return dateStr
  if (gran === 'month') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  const diff = (d.getDay() + 6) % 7
  const monday = new Date(d)
  monday.setDate(d.getDate() - diff)
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`
}

/** select / multiSelect 选项 id → label（找不到回退 id）。 */
function optionLabel(descriptor: FieldDescriptor<unknown>, id: string): string {
  const opts = typeof descriptor.options === 'function' ? descriptor.options() : descriptor.options ?? []
  return opts.find((o) => o.id === id)?.label ?? id
}

/**
 * 单字段分组：把已求值列表划分为桶。
 * - groupBy 为 null：返回单一全量桶。
 * - select：按选项 id 分桶，label 取自选项。
 * - date + dateBucket：按 day/week/month 分桶。
 * - multiSelect：按已选 id 组合分桶（label 为各选项 label 拼接）。
 * - 其余类型：按值字符串分桶。空值落入 '' 桶，label 为「（空）」。
 * 仅产出桶划分，不含聚合（计数等由 UI 现算）。
 */
export function groupItems<T>(items: T[], groupBy: string | null, registry: Registry, entityType: string): Group<T>[] {
  if (!groupBy) return [{ key: '', label: '', items }]
  const descriptor = registry.get(entityType, groupBy) as FieldDescriptor<unknown> | undefined
  if (!descriptor) return [{ key: '', label: '', items }]

  const buckets = new Map<string, Group<T>>()
  for (const item of items) {
    const value = normalize(descriptor.get(item))
    let key: string
    let label: string
    if (descriptor.type === 'date' && descriptor.dateBucket) {
      key = dateBucketKey(String(value ?? ''), descriptor.dateBucket)
      label = key || '（空）'
    } else if (descriptor.type === 'multiSelect') {
      const ids = Array.isArray(value) ? (value as unknown[]).map(String) : value === undefined ? [] : [String(value)]
      key = ids.join(',')
      label = ids.length ? ids.map((id) => optionLabel(descriptor, id)).join(', ') : '（空）'
    } else if (descriptor.type === 'select') {
      key = value === undefined ? '' : String(value)
      label = value === undefined ? '（空）' : optionLabel(descriptor, key)
    } else {
      key = value === undefined ? '' : String(value)
      label = value === undefined ? '（空）' : key
    }
    if (!buckets.has(key)) buckets.set(key, { key, label, items: [] })
    buckets.get(key)!.items.push(item)
  }
  return [...buckets.values()]
}

/**
 * 求值入口：对 items 全量过滤 + 排序，返回原集合的子集（不修改入参）。
 * 纯函数，重算交给调用方缓存。分组由调用方按需对返回结果调用 groupItems（与求值解耦）。
 */
export function evaluate<T>(query: ViewQuery, items: T[], registry: Registry, entityType: string, context?: QueryContext): T[] {
  const filtered = items.filter((item) => evalGroup(query.filter, item, registry, entityType, context))
  return sortItems(filtered, query.sort, registry, entityType)
}
