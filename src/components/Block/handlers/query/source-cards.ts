import type { BlockCard } from '../../../../wasm/types'

/**
 * 空块判定 —— 查询块数据源的第一道剔除：**没有可读文本即视为空块**。
 *
 * 只看 `content_preview`（Rust `make_content_preview` 已剥掉 `{{schedule|deadline:…}}`、
 * 折叠空白并 truncate，这里再 trim 一次兜住手工构造的脏值）。
 *
 * 为什么不把「有 properties / date_refs / tags」当作非空：块内查询的辨识手段就是内容列，
 * 一条没有正文的行在表里是一格空白，读不出它是什么、点开也只有一个空块 —— 与「空块」
 * 在用户眼里没有区别。属性齐备但没有正文的行（如只设了 status+priority 的孤儿块）也一并剔除，
 * 它属于数据卫生问题，该在任务中心或正文里清理，不该在块内列表里当噪声。
 */
export function isEmptyCard(card: BlockCard): boolean {
  return (card.content_preview ?? '').trim() === ''
}

/**
 * 从投影里剔除空块。保持原顺序与原对象引用（引擎按引用做缓存，不复制卡片）。
 *
 * 为什么在数据源层而不是加一条默认筛选条件：空块不是「用户可能会想看的另一种结果」，
 * 而是文档里每条空行都算一个块的副产物 —— 让它们进结果集，正文里插一个查询块就会
 * 吐出成百上千条空白行，且任何筛选/分组都在这个噪声上叠加。
 */
export function excludeEmptyCards(cards: BlockCard[]): BlockCard[] {
  return cards.filter((c) => !isEmptyCard(c))
}
