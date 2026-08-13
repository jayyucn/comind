/**
 * Page 查询引擎桥接 —— 把无头引擎接到 Page（issue #25）。
 *
 * 纯函数，不依赖 Vue / Pinia / WASM：
 * - filterSortPages：evaluate 全量过滤 + 多键排序
 * - groupPages：对过滤后列表单字段分组（groupItems）
 * - runPageQuery：过滤 + 排序 + 分组一步到位，返回分组桶（视图层按需 flatten 或按桶渲染）
 */
import { evaluate, groupItems, type Group, type Registry, type ViewQuery } from '../core/query'
import type { Page } from '../types/page'
import { PAGE_ENTITY } from './usePageQueryRegistry'

/** 过滤 + 排序，返回 Page[]（与 legacy 页面列表同形状，方便视图平替）。 */
export function filterSortPages(
  pages: Page[],
  query: ViewQuery,
  registry: Registry,
  entityType: string = PAGE_ENTITY,
): Page[] {
  return evaluate(query, pages, registry, entityType)
}

/** 对过滤后列表按单字段分组，返回分组桶。 */
export function groupPages(
  items: Page[],
  groupBy: string | null,
  registry: Registry,
  entityType: string = PAGE_ENTITY,
): Group<Page>[] {
  return groupItems(items, groupBy, registry, entityType)
}

/** 端到端：过滤 + 排序 + 分组，返回分组桶数组（groupBy 为 null 时返回单一全量桶）。 */
export function runPageQuery(
  pages: Page[],
  query: ViewQuery,
  registry: Registry,
  entityType: string = PAGE_ENTITY,
): Group<Page>[] {
  const sorted = evaluate(query, pages, registry, entityType)
  return groupItems(sorted, query.groupBy, registry, entityType)
}
