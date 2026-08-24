/**
 * 查询引擎工厂（ADR-0022 Q7）——实体无关的过滤/排序/分组一步到位。
 *
 * 替代逐实体复制的 useBlockQueryEngine / usePageQueryEngine（原 47/48 行
 * 函数体逐字相同、仅类型名 BlockCard ↔ Page 不同）。entityType 在工厂创建时
 * 绑定一次，调用点无需再传。
 *
 * context 透传至 evaluate，用于解析跨记录字段引用（recordRef）：跨记录引用
 * 需要按 entityType+id 取实体的能力，由消费方（如 PagesLibrary）从页面 store
 * 注入 getById；不传则 recordRef 一律非匹配。
 */
import { evaluate, groupItems, type Group, type QueryContext, type Registry, type ViewQuery } from './index'

export interface QueryEngine<T> {
  /** 过滤 + 排序，返回 T[]。 */
  filterSort(items: T[], query: ViewQuery, registry: Registry, context?: QueryContext): T[]
  /** 对过滤后列表按单字段分组，返回分组桶。 */
  group(items: T[], groupBy: string | null, registry: Registry, context?: QueryContext): Group<T>[]
  /** 端到端：过滤 + 排序 + 分组，返回分组桶数组（groupBy 为 null 时返回单一全量桶）。 */
  run(items: T[], query: ViewQuery, registry: Registry, context?: QueryContext): Group<T>[]
}

export function createQueryEngine<T>(entityType: string): QueryEngine<T> {
  return {
    filterSort: (items, query, registry, context) =>
      evaluate(query, items, registry, entityType, context),
    group: (items, groupBy, registry) =>
      groupItems(items, groupBy, registry, entityType),
    run: (items, query, registry, context) =>
      groupItems(evaluate(query, items, registry, entityType, context), query.groupBy, registry, entityType),
  }
}
