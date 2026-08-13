/**
 * 序列化 / 反序列化 —— 无头核心，纯 TS，不依赖 Vue / Pinia。
 *
 * ViewQuery 与 JSON 字符串双向转换。序列化写入 version: 1；反序列化对缺失/异常字段
 * 补默认值（空 filter 组、空 sort、groupBy 为 null），保证旧数据或残缺数据不崩溃。
 * 迁移链机制暂缓——仅保留 version 位，首个 v2 出现时再实现 migrate() 分支。
 */
import type { Condition, ConditionGroup, FilterOp, SortRule, ViewQuery } from './types'

/** 把 ViewQuery 序列化为带 version 的 JSON 字符串。 */
export function serializeQuery(query: ViewQuery): string {
  return JSON.stringify({ ...query, version: 1 })
}

/** 归一化单个条件：保证 field/op 存在，value 缺失则省略（isEmpty/isNotEmpty 无 value）。 */
function normalizeCondition(raw: unknown): Condition {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const cond: Condition = {
    field: typeof o.field === 'string' ? o.field : '',
    op: (typeof o.op === 'string' ? o.op : 'is') as FilterOp,
  }
  if (o.value !== undefined) cond.value = o.value
  return cond
}

/** 递归归一化条件组：combinator 非 or 即 and；children 为数组，子节点按形状分派为组/条件。 */
function normalizeGroup(raw: unknown): ConditionGroup {
  if (!raw || typeof raw !== 'object') return { combinator: 'and', children: [] }
  const o = raw as Record<string, unknown>
  const group: ConditionGroup = {
    combinator: o.combinator === 'or' ? 'or' : 'and',
    children: Array.isArray(o.children)
      ? o.children.map((c) => (c && typeof c === 'object' && 'children' in c ? normalizeGroup(c) : normalizeCondition(c)))
      : [],
  }
  if (typeof o.negate === 'boolean') group.negate = o.negate
  return group
}

/**
 * 从 JSON 字符串（或已解析对象）还原 ViewQuery。任何残缺/非法输入都降级为默认查询，不抛错。
 * 保留 version 字段，供未来的 migrate() 分支使用。
 */
export function parseQuery(input: string | unknown): ViewQuery {
  let raw: unknown
  try {
    raw = typeof input === 'string' ? JSON.parse(input) : input
  } catch {
    raw = {}
  }
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>

  const sort: SortRule[] = Array.isArray(o.sort)
    ? o.sort.filter(
        (r): r is SortRule =>
          !!r && typeof r === 'object' && typeof (r as SortRule).field === 'string' && ((r as SortRule).dir === 'asc' || (r as SortRule).dir === 'desc'),
      )
    : []

  return {
    // 仅 v1：保留 version 位，首个 v2 出现时在此分支做 migrate()
    version: (typeof o.version === 'number' ? o.version : 1) as 1,
    filter: normalizeGroup(o.filter),
    sort,
    groupBy: typeof o.groupBy === 'string' ? o.groupBy : null,
  }
}
