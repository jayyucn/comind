/**
 * chip → 卡片/预览 的拆分计划（ADR-0067 D3）。
 *
 * 用户裁定「拆旧建新」：chip 在 text 块正文里，切到卡片/预览要拆成
 *   [前文本 block] + [web-link block] + [后文本 block]   （前后为空则不建）。
 *
 * 反向（卡片/预览 → chip）不需要计划：原 web-link 块就地换回 text、正文只写
 * 这一颗 chip 字面，前后兄弟块一概不动（`services/web-link-actions.convertCardToChip`）。
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
