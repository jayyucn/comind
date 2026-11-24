/**
 * 有序列表序号推导（纯函数层）。
 *
 * ## 为什么需要它
 *
 * 有序列表不是块类型，而是 bullet 块正文的前缀（`1. `，见 `parseParagraphStyle`）。
 * 一旦序号只是「字面数字」，结构一动就失真：删掉中间项得到 `1, 3, 4`，缩进/拖动/粘贴
 * 之后同段落里的项各说各话。这里把「第几项」从字面里**推导**出来，再写回正文
 * （真源仍是 content —— 读写渲染三处共用一份数据，视图侧不必再各算一遍）。
 *
 * ## 段落与推导规则
 *
 * - **段**＝同一父块下**连续**的有序列表块。遇到正文 / 标题 / 无序列表 / 空文本块即断。
 *   子块是独立段，各自从自己的段首起算。
 * - **段首起点恒为 1**，段内逐项 `desired = cursor`，然后 `cursor += 1`。段首字面不参与
 *   推导：手写的 `5. ` 同样会被改写成 `1. `，段内跳号（`1, 10, 11`）一律抹平。
 * - **透明块**：非文本块（代码 / 图片 / 表格 / 查询 / embed）与高亮块（`format.callout`）
 *   既不**打断**段、也不**占号** —— 段跨过它们继续 1, 2, 3。透明块自身若带 `1. ` 前缀，
 *   字面原样保留为普通文本（不改写、不参与序列）。
 *
 * ## 纯函数的边界
 *
 * 这里只算「应该是什么」。谁该跳过（正在打字的块）、何时落库、归一到哪个段，
 * 都是 `stores/blocks.ts` 的 `applyOrderedListNumbering` 的事 —— 纯函数不认识 store，
 * 才好逐条钉用例。
 */
import { calloutToneOf } from '../utils/callout'
import { parseParagraphStyle } from './useContentRenderer'

/**
 * 同段同父的一个兄弟块。`format` / `type` 可为空（新块还没有 format）。
 * 调用方保证数组已按 `pos` 升序且同属一个父块。
 */
export interface OrderedListSibling {
  id: string
  content: string
  /** 块类型；非 `text` 的块对编号透明。缺省按文本块处理。 */
  type?: string | null
  format?: Record<string, unknown> | null
}

export interface OrderedListEntry {
  id: string
  /** 改写前的字面序号；`null` = 不在有序列表段内（含透明块） */
  literal: number | null
  /** 推导出的目标序号；`null` = 不参与编号 */
  desired: number | null
  /** 目标正文（无需改写时等于原 content） */
  content: string
  /** 是否需要写回 */
  changed: boolean
}

/**
 * 本块是否对编号**透明**（既不打断段、也不占号）。
 *
 * 两类：非文本块（没有段落前缀这回事），以及高亮块 —— 高亮活在 `format.callout` 里，
 * 是视觉强调而不是列表结构，列表被一段提示打断时不该重新从 1 起算。
 */
export function isTransparentForNumbering(
  sibling: Pick<OrderedListSibling, 'type' | 'format'>,
): boolean {
  if (sibling.type != null && sibling.type !== 'text') return true
  return calloutToneOf(sibling.format) !== null
}

/** 本块是否在有序列表段内（判据与渲染/续行同一份 `parseParagraphStyle`） */
export function isOrderedListItem(content: string): boolean {
  return parseParagraphStyle(content).style === 'ol'
}

/** 把正文的首个序号改成 `index`（正文其余部分一个字不动；非有序列表原样返回） */
export function orderedListContentAtIndex(content: string, index: number): string {
  const info = parseParagraphStyle(content)
  if (info.style !== 'ol') return content
  return `${index}. ${info.title}`
}

/**
 * 推演一个父块下（已按 pos 升序）的期望序号。
 *
 * 返回与输入等长的数组：非列表项与透明块也在其中（`desired` 为 null），
 * 调用方可以按 id 直接取。
 */
export function planOrderedListNumbering(
  siblings: readonly OrderedListSibling[],
): OrderedListEntry[] {
  const entries: OrderedListEntry[] = []
  // null = 当前不在序号段内；段内则记「下一项应该是几」
  let cursor: number | null = null

  for (const sibling of siblings) {
    if (isTransparentForNumbering(sibling)) {
      // 透明：cursor 原样保留 —— 段跨过代码块/图片/高亮块继续
      entries.push({ id: sibling.id, literal: null, desired: null, content: sibling.content, changed: false })
      continue
    }

    const info = parseParagraphStyle(sibling.content)
    if (info.style !== 'ol' || info.listIndex === null) {
      cursor = null
      entries.push({ id: sibling.id, literal: null, desired: null, content: sibling.content, changed: false })
      continue
    }

    // 段首恒 1：字面只是「上一轮写回的结果」，不是起点依据
    if (cursor === null) cursor = 1

    const content = orderedListContentAtIndex(sibling.content, cursor)
    entries.push({
      id: sibling.id,
      literal: info.listIndex,
      desired: cursor,
      content,
      changed: content !== sibling.content,
    })
    cursor += 1
  }

  return entries
}

/** 本块作为有序列表项时应显示的序号（不含则 null） */
export function orderedListIndexAt(siblings: readonly OrderedListSibling[], blockId: string): number | null {
  const entry = planOrderedListNumbering(siblings).find(candidate => candidate.id === blockId)
  return entry?.desired ?? null
}

/**
 * 「本块之后新起一项」的序号（Enter 续行 / 拆分）。
 *
 * 取的是本块的**推导值 + 1**，而不是字面 + 1 —— 正在打字的块字面可能落后于推导。
 */
export function nextOrderedListIndexAfter(
  siblings: readonly OrderedListSibling[],
  blockId: string,
): number {
  const index = orderedListIndexAt(siblings, blockId)
  return index === null ? 1 : index + 1
}

/**
 * 「把本块转成有序列表」应使用的序号。
 *
 * - 本块已在段内（重复设同一段样式）→ 推导值
 * - 否则接上前一个有序列表兄弟；前面不是列表（或隔着透明块但更前面也不是列表）则从 1 起
 */
export function orderedListIndexForNewItem(
  siblings: readonly OrderedListSibling[],
  blockId: string,
): number {
  const plan = planOrderedListNumbering(siblings)
  const index = plan.findIndex(entry => entry.id === blockId)
  if (index < 0) return 1
  const self = plan[index]
  if (self.desired !== null) return self.desired
  // 往回找第一项「有结论」的块：透明块跳过（段跨过它仍然开着），撞到断点则从 1 起
  for (let i = index - 1; i >= 0; i--) {
    if (plan[i].desired !== null) return (plan[i].desired as number) + 1
    if (!isTransparentForNumbering(siblings[i])) break
  }
  return 1
}
