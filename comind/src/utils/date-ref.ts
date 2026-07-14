/**
 * dateRef 语法单一事实来源
 *
 * 语法：{{kind:ISO本地时间|recurrence?}}
 *   kind       ∈ schedule | deadline
 *   ISO 本地时间 2026-07-15T14:00（不带时区后缀 Z）
 *   recurrence ∈ none | daily | weekly | monthly | yearly（缺省 none）
 *
 * 所有层（DateRefExtension / useContentRenderer / date-ref-index / 命令 / 自动推进）
 * 共用本文件的解析与序列化逻辑，禁止在各处重复编写正则。
 */

export type DateRefKind = 'schedule' | 'deadline'
export type RecurrenceRule = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface DateRef {
  kind: DateRefKind
  /** 本地 ISO，形如 2026-07-15T14:00 或 2026-07-15（全天） */
  iso: string
  recurrence: RecurrenceRule
}

const RECURRENCE_RULES: RecurrenceRule[] = ['none', 'daily', 'weekly', 'monthly', 'yearly']

/**
 * 匹配 {{schedule:2026-07-15T14:00|weekly}} 或 {{deadline:2026-07-15}}
 * 注意：全局正则带 lastIndex 状态，调用方应每次 new RegExp 后使用，避免复用污染。
 */
export const DATE_REF_REGEX = /\{\{(schedule|deadline):([^}|]+?)(?:\|([^}]+?))?\}\}/g

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
    })
  }
  return result
}

/** 结构化 dateRef → 文本语法。recurrence 为 none 时省略 | 段 */
export function serializeDateRef(ref: DateRef): string {
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
 *   2026-07-15T14:00 → 07-15 14:00
 *   2026-07-15       → 07-15
 */
export function formatIsoDisplay(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/)
  if (!m) return iso
  const [, , mm, dd, hh, min] = m
  const time = hh !== undefined ? ` ${hh}:${min}` : ''
  return `${mm}-${dd}${time}`
}
