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
 * 共用本文件的解析与序列化逻辑，禁止在各处重复编写正则。
 *
 * ⚠️ 存储层提取已迁 Rust（comind-core::services::DateRefService）。DateRef 表是
 * date-ref 的派生存储事实来源，由 BlockService 在 block 写入路径中维护，并通过
 * core.queryDateRefs / queryOverdueDateRefs / getDateRefsByBlock 查询。
 * 本文件的 parseDateRefs 仅保留给「渲染/展示期解析」使用
 * （DateTimePickerPanel、SlashCommandMenu、useContentRenderer、notification-service、
 * property 等），请勿将其解析结果当作存储索引的唯一事实来源。
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

/** emoji → kind 映射 */
const EMOJI_TO_KIND: Record<string, DateRefKind> = {
  '📅': 'schedule',
  '⏰': 'deadline',
}

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
 * 从文本中提取所有 dateRef（同 block 可含多个）
 * 解析 @ISO[emoji][|params] 格式
 */
export function parseDateRefs(text: string): DateRef[] {
  const result: { ref: DateRef; pos: number }[] = []
  if (!text) return []

  const re = new RegExp(DATE_REF_AT_REGEX.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const iso = m[1]
    const emoji = m[2]
    const kind: DateRefKind = emoji ? (EMOJI_TO_KIND[emoji] ?? 'ref') : 'ref'
    const recurrence = normalizeRecurrence(m[3])
    const leadMinutes = m[4] ? parseInt(m[4], 10) || 0 : 0
    result.push({ ref: { kind, iso, recurrence, leadMinutes }, pos: m.index })
  }

  // 按文本位置排序，保持原始顺序
  result.sort((a, b) => a.pos - b.pos)
  return result.map((r) => r.ref)
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
