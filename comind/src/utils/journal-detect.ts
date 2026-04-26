// utils/journal-detect.ts
import { parse, isValid } from 'date-fns'

/**
 * 预定义日记日期格式列表
 * 用作 isJournalTitle、parseToDate、useJournal 的统一格式来源
 */
export const JOURNAL_FORMATS = [
  'yyyy-MM-dd',       // 2026-04-26（最常见）
  'yyyy/MM/dd',       // 2026/04/26
  'yyyy_MM_dd',       // 2026_04_26
  'MMM do, yyyy',     // Apr 26th, 2026
  'EEEE, MMMM do, yyyy', // Saturday, April 26th, 2026
  'MM/dd/yyyy',       // 04/26/2026
  'dd.MM.yyyy',       // 26.04.2026
  'yyyy年M月d日',      // 2026年4月26日
] as const

/**
 * 尝试将标题解析为 Date（返回 null 表示不是有效日期）
 * 用 format 列表逐个尝试，与 isJournalTitle 保持一致
 */
export function parseToDate(title: string): Date | null {
  const trimmed = title.trim()
  if (!trimmed) return null
  for (const fmt of JOURNAL_FORMATS) {
    const parsed = parse(trimmed, fmt, new Date())
    if (isValid(parsed)) return parsed
  }
  return null
}

/**
 * 判断页面标题是否匹配日记格式
 *
 * 策略（对齐 Logseq 的 convert-page-if-journal）：
 * 用预定义的日期格式列表逐个尝试解析标题，
 * 匹配成功 → journal，否则 → normal
 */
export function isJournalTitle(title: string): boolean {
  const trimmed = title.trim()
  if (!trimmed) return false

  // 快速短路：最常见的 yyyy-MM-DD 格式
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return true

  return JOURNAL_FORMATS.some(fmt => {
    const parsed = parse(trimmed, fmt, new Date())
    return isValid(parsed)
  })
}

/**
 * 根据标题自动推断 Page type
 * 隐式创建时统一调用此函数，消除各处散落的 type 判断
 */
export function inferPageType(title: string): 'normal' | 'journal' {
  return isJournalTitle(title) ? 'journal' : 'normal'
}
