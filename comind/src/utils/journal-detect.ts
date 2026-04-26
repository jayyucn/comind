// utils/journal-detect.ts
import { parse, isValid, format } from 'date-fns'

/**
 * 预定义日记日期格式列表
 * 仅用于检测（isJournalTitle / parseToDate / normalizeJournalTitle），
 * 不用于创建——创建时统一用 yyyy-MM-dd 规范格式
 */
export const JOURNAL_FORMATS = [
  'yyyy-MM-dd',       // 2026-04-26（最常见，也是存储规范格式）
  'yyyy/MM/dd',       // 2026/04/26
  'yyyy_MM_dd',       // 2026_04_26
  'MMM do, yyyy',     // Apr 26th, 2026
  'EEEE, MMMM do, yyyy', // Saturday, April 26th, 2026
  'MM/dd/yyyy',       // 04/26/2026
  'dd.MM.yyyy',       // 26.04.2026
  'yyyy年M月d日',      // 2026年4月26日
] as const

/** 日记标题的规范存储格式 */
export const JOURNAL_CANONICAL_FORMAT = 'yyyy-MM-dd'

/**
 * 尝试将标题解析为 Date（返回 null 表示不是有效日期）
 * 用 format 列表逐个尝试解析
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
 * 委托 parseToDate，单一解析入口
 */
export function isJournalTitle(title: string): boolean {
  return parseToDate(title) !== null
}

/**
 * 将日记标题规范化为 yyyy-MM-dd
 * - 匹配日记格式 → 返回规范标题（如 "2026-04-26"）
 * - 不匹配 → 返回 null（不是日记标题）
 *
 * 用途：[[]] 解析、页面查找/创建时，统一规范化避免同一天出现多个 Page
 */
export function normalizeJournalTitle(title: string): string | null {
  const parsed = parseToDate(title)
  if (!parsed) return null
  return format(parsed, JOURNAL_CANONICAL_FORMAT)
}

/**
 * 根据标题自动推断 Page type
 * 隐式创建时统一调用此函数，消除各处散落的 type 判断
 */
export function inferPageType(title: string): 'normal' | 'journal' {
  return isJournalTitle(title) ? 'journal' : 'normal'
}
