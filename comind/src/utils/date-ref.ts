/**
 * dateRef 语法单一事实来源
 *
 * 语法：{{kind:ISO本地时间|recurrence?}}
 *   kind       ∈ schedule | deadline
 *   ISO 本地时间 2026-07-15T14:00（不带时区后缀 Z）
 *   recurrence ∈ none | daily | weekly | monthly | yearly（缺省 none）
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

export type DateRefKind = 'schedule' | 'deadline'
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
 * 匹配 {{schedule:2026-07-15T14:00|weekly}} 或 {{deadline:2026-07-15}} 或 {{schedule:2026-07-15|weekly|15}}
 * 注意：全局正则带 lastIndex 状态，调用方应每次 new RegExp 后使用，避免复用污染。
 */
export const DATE_REF_REGEX = /\{\{(schedule|deadline):([^}|]+?)(?:\|([^}|]*))?(?:\|([^}]+?))?\}\}/g

export function normalizeRecurrence(rec: string | undefined): RecurrenceRule {
  return rec && (RECURRENCE_RULES as string[]).includes(rec) ? (rec as RecurrenceRule) : 'none'
}

/** 从文本中提取所有 dateRef（同 block 可含多个） */
export function parseDateRefs(text: string): DateRef[] {
  const result: DateRef[] = []
  if (!text) return result
  const re = new RegExp(DATE_REF_REGEX.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    result.push({
      kind: m[1] as DateRefKind,
      iso: m[2],
      recurrence: normalizeRecurrence(m[3]),
      leadMinutes: m[4] ? parseInt(m[4], 10) || 0 : 0,
    })
  }
  return result
}

/** 结构化 dateRef → 文本语法。recurrence 为 none 时省略 | 段；leadMinutes > 0 时追加第三段 */
export function serializeDateRef(ref: DateRef): string {
  const lead = ref.leadMinutes && ref.leadMinutes > 0 ? ref.leadMinutes : 0
  if (lead > 0 && ref.recurrence !== 'none') {
    return `{{${ref.kind}:${ref.iso}|${ref.recurrence}|${lead}}}`
  }
  if (lead > 0 && ref.recurrence === 'none') {
    return `{{${ref.kind}:${ref.iso}||${lead}}}`
  }
  const rec = ref.recurrence && ref.recurrence !== 'none' ? `|${ref.recurrence}` : ''
  return `{{${ref.kind}:${ref.iso}${rec}}}`
}

/** 渲染展示文本（emoji 前缀 + 智能格式化 + 重复标记；逾期变红由 CSS 类处理） */
export function formatDateRefDisplay(ref: DateRef): string {
  const prefix = ref.kind === 'schedule' ? '📅' : '⏰'
  const recPart = ref.recurrence !== 'none' ? ` · ${recurrenceLabel(ref.recurrence)}` : ''
  return `${prefix} ${formatIsoDisplay(ref.iso)}${recPart}`
}

const REC_LABELS: Record<RecurrenceRule, string> = {
  none: '',
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
  yearly: '每年',
}

function recurrenceLabel(rec: RecurrenceRule): string {
  return REC_LABELS[rec] || ''
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
