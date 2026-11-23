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
 * - **段**＝同一父块下**连续**的有序列表块。遇到正文/标题/无序列表即断（决策 1）。
 *   子块是独立段，各自从自己的段首起算（决策 4）。
 * - `cur = 段首锚点 ?? 段首字面`；逐项 `desired = cur`，然后 `cur += 1`。
 *   「段首字面作起始值」保证存量文档里从 5 开始的列表不被改写成 1（决策 3）。
 * - **锚点**（`format.olIndex`）是挂在块上的绝对起点：手写跳号（`1, 10, 11`）、
 *   删段首后强制回 1，都落成锚点。锚点之前的增删不影响它，前面不动、允许断点（决策 10/17）。
 *
 * ## 纯函数的边界
 *
 * 这里只算「应该是什么」。谁该跳过（正在打字的块）、何时落库、锚点何时写入/清除，
 * 都是 `stores/blocks.ts` 的 `applyOrderedListNumbering` 的事 —— 纯函数不认识 store，
 * 才好逐条钉用例。
 */
import { parseParagraphStyle } from './useContentRenderer'

/** `format` 上承载「本块序号锚点」的键。锚点＝绝对序号，不是「+1 偏置」 */
export const ORDERED_LIST_ANCHOR_KEY = 'olIndex'

/** 本块的有序列表锚点；无锚点 / 非法值为 null */
export function readOrderedListAnchor(format: Record<string, unknown> | null | undefined): number | null {
  const raw = format?.[ORDERED_LIST_ANCHOR_KEY]
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
  const index = Math.trunc(raw)
  return index >= 0 ? index : null
}

/**
 * 写入 / 清除锚点（返回新对象，不改入参）。
 *
 * 清除用 `null` —— 别用 `undefined`：`format` 会整体 JSON 序列化落库，
 * `{ olIndex: undefined }` 会被 `JSON.stringify` 丢掉，行为上等价但可读性差；
 * 显式 delete 让「无锚点」这件事在看数据时一眼可见。
 */
export function withOrderedListAnchor(
  format: Record<string, unknown> | null | undefined,
  index: number | null,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(format ?? {}) }
  if (index === null) delete next[ORDERED_LIST_ANCHOR_KEY]
  else next[ORDERED_LIST_ANCHOR_KEY] = Math.trunc(index)
  return next
}

/** 本块是否在有序列表段内（判据与渲染/续行同一份 `parseParagraphStyle`） */
export function isOrderedListItem(content: string): boolean {
  return parseParagraphStyle(content).style === 'ol'
}

/**
 * 同段同父的一个兄弟块。`format` 可为空（新块还没有 format）。
 * 调用方保证数组已按 `pos` 升序且同属一个父块。
 */
export interface OrderedListSibling {
  id: string
  content: string
  format?: Record<string, unknown> | null
}

export interface OrderedListEntry {
  id: string
  /** 改写前的字面序号；`null` = 不在有序列表段内 */
  literal: number | null
  /** 推导出的目标序号；`null` = 不在有序列表段内 */
  desired: number | null
  /** 目标正文（无需改写时等于原 content） */
  content: string
  /** 是否需要写回 */
  changed: boolean
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
 * 返回与输入等长的数组：非列表项也在其中（`desired` 为 null），调用方可以按 id 直接取。
 */
export function planOrderedListNumbering(
  siblings: readonly OrderedListSibling[],
): OrderedListEntry[] {
  const entries: OrderedListEntry[] = []
  // null = 当前不在序号段内；段内则记「下一项应该是几」
  let cursor: number | null = null

  for (const sibling of siblings) {
    const info = parseParagraphStyle(sibling.content)
    if (info.style !== 'ol' || info.listIndex === null) {
      cursor = null
      entries.push({ id: sibling.id, literal: null, desired: null, content: sibling.content, changed: false })
      continue
    }

    const anchor = readOrderedListAnchor(sibling.format)
    if (cursor === null) {
      // 段首：锚点优先，否则以字面为起始值
      cursor = anchor ?? info.listIndex
    } else if (anchor !== null) {
      // 段中锚点：手写跳号 / 删段首后强制回 1，从这里重新起算
      cursor = anchor
    }

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
 * - 否则接上前一个有序列表兄弟（决策 7），前面不是列表则从 1 起
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
  const prev = index > 0 ? plan[index - 1] : null
  return prev?.desired != null ? prev.desired + 1 : 1
}
