/**
 * Block 查询引擎桥接 —— 把无头引擎接到 BlockCard（issue #24）。
 *
 * 纯函数，不依赖 Vue / Pinia / WASM：
 * - filterSortBlockCards：evaluate 全量过滤 + 多键排序
 * - groupBlockCards：对过滤后列表单字段分组（groupItems）
 * - runBlockQuery：过滤 + 排序 + 分组一步到位，返回分组桶（视图层按需 flatten 或按桶渲染）
 *
 * context 透传至 evaluate，用于解析跨记录字段引用（recordRef）；不传则 recordRef 一律非匹配。
 */
import { evaluate, groupItems, type Group, type QueryContext, type Registry, type ViewQuery } from '../core/query'
import type { BlockCard } from '../wasm/types'
import { BLOCK_ENTITY } from './useBlockQueryRegistry'

/** 过滤 + 排序，返回 BlockCard[]（与旧 applyQuery 同形状，方便视图平替）。 */
export function filterSortBlockCards(
  cards: BlockCard[],
  query: ViewQuery,
  registry: Registry,
  entityType: string = BLOCK_ENTITY,
  context?: QueryContext,
): BlockCard[] {
  return evaluate(query, cards, registry, entityType, context)
}

/** 对过滤后列表按单字段分组，返回分组桶。 */
export function groupBlockCards(
  items: BlockCard[],
  groupBy: string | null,
  registry: Registry,
  entityType: string = BLOCK_ENTITY,
  context?: QueryContext,
): Group<BlockCard>[] {
  return groupItems(items, groupBy, registry, entityType)
}

/** 端到端：过滤 + 排序 + 分组，返回分组桶数组（groupBy 为 null 时返回单一全量桶）。 */
export function runBlockQuery(
  cards: BlockCard[],
  query: ViewQuery,
  registry: Registry,
  entityType: string = BLOCK_ENTITY,
  context?: QueryContext,
): Group<BlockCard>[] {
  const sorted = evaluate(query, cards, registry, entityType, context)
  return groupItems(sorted, query.groupBy, registry, entityType)
}
