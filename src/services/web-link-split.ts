/**
 * chip ↔ 卡片/预览 的拆建计划（ADR-0067 D3）。
 *
 * 用户裁定「拆旧建新」：chip 在 text 块正文里，切到卡片/预览要拆成
 *   [前文本 block] + [web-link block] + [后文本 block]   （前后为空则不建）；
 * 反向切回 chip 要把三段合并成一个 text 块，content 还原为 `[标题](url)`。
 *
 * 本模块是纯函数：只算「计划」，不碰 store。执行由服务层按计划调用 store。
 */

export interface SplitPlan {
  /** 原 text 块是否保留作「前文本」；false = 删除 */
  keepAsBefore: boolean
  /** 前文本 content（keepAsBefore 时写回原块） */
  before: string
  /** 后文本 content（非空时需新建块） */
  after: string
  /** web-link 块的 URL */
  url: string
  /** web-link 块的显示标题（作为 format.link.meta.title 的种子） */
  title: string
  /** 新建块的插入基准：原块 pos；调用方按 before/after 顺序排 pos */
  pos: number
}

/** 从含 chip 的 text 块算出「切到卡片/预览」的拆建计划 */
export function planChipToCard(args: {
  content: string
  start: number
  end: number
  title: string
  url: string
  pos: number
}): SplitPlan {
  const before = args.content.slice(0, args.start)
  const after = args.content.slice(args.end)
  return {
    keepAsBefore: before.trim().length > 0,
    before,
    after,
    url: args.url,
    title: args.title,
    pos: args.pos,
  }
}

/** 合并计划：卡片/预览切回 chip 时，三段文本如何还原 */
export interface MergePlan {
  /** 合并后的 text 块 content */
  content: string
  /** 需要删除的兄弟块 id（前/后文本块），web-link 块本身由调用方删除 */
  removeIds: string[]
}

export function planCardToChip(args: {
  url: string
  title: string
  beforeContent?: string
  beforeId?: string
  afterContent?: string
  afterId?: string
}): MergePlan {
  const parts: string[] = []
  const removeIds: string[] = []
  if (args.beforeContent) parts.push(args.beforeContent)
  parts.push(`[${args.title}](${args.url})`)
  if (args.afterContent) parts.push(args.afterContent)
  if (args.beforeId) removeIds.push(args.beforeId)
  if (args.afterId) removeIds.push(args.afterId)
  return { content: parts.join(''), removeIds }
}
