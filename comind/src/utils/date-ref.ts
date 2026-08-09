/**
 * dateRef 语法单一事实来源
 *
 * 语法（@ 格式，统一入口）：
 *    @ISO本地时间 [emoji][|recurrence?|leadMinutes?]
 *    - @2026-08-03         → kind=ref（纯日期引用，无通知，无图谱）
 *    - @2026-08-03 📅      → kind=schedule（计划日期）
 *    - @2026-08-03 ⏰      → kind=deadline（截止日期）
 *    - @2026-08-03 📅|weekly  → kind=schedule + recurrence
 *    - @2026-08-03 ⏰||30     → kind=deadline + leadMinutes
 *
 * 所有层（DateRefExtension / useContentRenderer / 命令 / 自动推进）
 * 共用本文件的序列化逻辑，禁止在各处重复编写正则。
 *
 * ⚠️ 解析/提取已全面迁 Rust（comind-core::services::DateRefService）。
 * TS 侧不再自行解析 dateRef；全部通过 client.getDateRefsByBlock / getDateRefsByPage 查询。
 * 本文件保留 `DATE_REF_AT_REGEX` / `serializeDateRef` / `formatIsoDisplay` / `normalizeRecurrence`
 * 供 Tiptap Extension 和编辑器 render 使用。
 */

export type DateRefKind = 'ref' | 'schedule' | 'deadline'
export type RecurrenceRule = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface DateRef {
  kind: DateRefKind
  /** 本地 ISO，形如 2026-07-15T14:00 或 2026-07-15（全天） */
  iso: string
  recurrence: RecurrenceRule
  /** 提前提醒分钟数（0 = 准时），通过 date-ref 语法第三段指定 */
  leadMinutes: number
}

const RECURRENCE_RULES: RecurrenceRule[] = ['none', 'daily', 'weekly', 'monthly', 'yearly']

/**
 * 匹配 @ 语法：@2026-08-03 或 @2026-08-03T14:00 后跟可选 emoji 和参数
 *   @2026-08-03           → kind=ref
 *   @2026-08-03 📅        → kind=schedule
 *   @2026-08-03 ⏰        → kind=deadline
 *   @2026-08-03 📅|weekly → kind=schedule + recurrence
 *   @2026-08-03 ⏰||30    → kind=deadline + leadMinutes
 *
 * 注意：@ 前不能是字母/数字/字幕（避免匹配 email 等）。
 */
export const DATE_REF_AT_REGEX = /(?<![\w@])@(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2})?)(?:[ \u00A0]?(📅|⏰))?(?:\|(daily|weekly|monthly|yearly|none)?)?(?:\|(\d+))?/g

/** kind → emoji 映射 */
const KIND_TO_EMOJI: Record<string, string | undefined> = {
  ref: undefined,
  schedule: '📅',
  deadline: '⏰',
}

export function normalizeRecurrence(rec: string | undefined): RecurrenceRule {
  return rec && (RECURRENCE_RULES as string[]).includes(rec) ? (rec as RecurrenceRule) : 'none'
}

/**
 * 结构化 dateRef → 文本语法。
 *
 * - kind=ref：`@ISO` 或 `@ISO|recurrence|lead`
 * - kind=schedule/deadline：`@ISO 📅` 或 `@ISO ⏰`
 */
export function serializeDateRef(ref: DateRef): string {
  const lead = ref.leadMinutes && ref.leadMinutes > 0 ? ref.leadMinutes : 0
  const emoji = KIND_TO_EMOJI[ref.kind]
  const emojiPart = emoji ? ` ${emoji}` : ''

  // 构建 | 参数段
  let params = ''
  if (lead > 0 && ref.recurrence !== 'none') {
    params = `|${ref.recurrence}|${lead}`
  } else if (lead > 0 && ref.recurrence === 'none') {
    params = `||${lead}`
  } else if (ref.recurrence && ref.recurrence !== 'none') {
    params = `|${ref.recurrence}`
  }

  return `@${ref.iso}${emojiPart}${params}`
}

/**
 * 本地 ISO → 展示文本
 *   不是今年：   2025-07-15T14:00 → 2025-07-15 14:00
 *              2025-07-15       → 2025-07-15
 *   今年：      2026-07-15T14:00 → 07-15 14:00
 *              2026-07-15       → 07-15
 */
export function formatIsoDisplay(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/)
  if (!m) return iso
  const [, year, mm, dd, hh, min] = m
  const time = hh !== undefined ? ` ${hh}:${min}` : ''
  const now = new Date()
  if (parseInt(year, 10) !== now.getFullYear()) {
    return `${year}-${mm}-${dd}${time}`
  }
  return `${mm}-${dd}${time}`
}
