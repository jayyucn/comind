import type { BlockCard } from '../../wasm/types'

/** 四象限落格优先级集合（与 QuadrantView 的 QUADRANTS 顺序一致）。 */
export const QUADRANT_PRIORITIES: readonly string[] = ['Medium', 'Urgent', 'Low', 'High']

/**
 * 四象限数据源谓词：与 tag 无关，仅要求 block 具备 priority（∈ 四象限优先级）且 status 非空。
 * 满足即纳入数据源；具体的落格资格（如 Done 须昨日后、排除 Canceled）由 QuadrantView.qualifies
 * 进一步裁定。这样即使 block 未挂载 #任务（或任意任务 tag），只要在编辑器/斜杠命令里设过
 * priority + status，就会出现在矩阵中。
 *
 * 空 content 的块不入矩阵（与 TaskHub.searchedCards 同口径）：content_preview 为空时
 * 视图只会回退显示 block id，无标题语义。
 */
export function isQuadrantCard(card: BlockCard, query = ''): boolean {
  if (!(card.content_preview ?? '').trim()) return false
  const pr = card.properties?.['priority']
  if (pr == null || pr === '' || !QUADRANT_PRIORITIES.includes(String(pr))) return false
  const st = card.properties?.['status']
  if (st == null || st === '') return false
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (card.content_preview ?? '').toLowerCase().includes(q)
}
