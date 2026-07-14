/**
 * 重复规则计算
 *
 * 输入本地 ISO（2026-07-15T14:00 或 2026-07-15，不带时区后缀 Z），
 * 按规则推进后返回同等格式的本地 ISO。
 */

import type { RecurrenceRule } from './date-ref'

function parseIsoLocal(iso: string): Date | null {
  // 含时间（无 Z）：ISO 串按本地时区解析，符合本项目「本地 ISO」约定
  if (/T\d/.test(iso)) {
    const d = new Date(iso)
    return isNaN(d.getTime()) ? null : d
  }
  // 仅日期 YYYY-MM-DD：必须显式按本地构造，否则会被当 UTC 导致时区偏移（如 GMT+8 下变成 08:00）
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10))
}

function toIsoLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function toDateOnly(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 月末/闰年安全的加月：保留原日，超出新月份最后一天则截断 */
function advanceMonth(d: Date): void {
  const day = d.getDate()
  const nextMonth = d.getMonth() + 1
  // 下个月最后一天：month index 为 nextMonth+1、day 为 0 → 即 nextMonth 月末
  const lastDay = new Date(d.getFullYear(), nextMonth + 1, 0).getDate()
  d.setMonth(nextMonth, Math.min(day, lastDay))
}

/** 闰年安全加年：2/29 在非闰年归到 2/28（直接 setFullYear 会因无效日自动跨月，需先 clamp） */
function advanceYear(d: Date): void {
  const day = d.getDate()
  const nextYear = d.getFullYear() + 1
  // 次年同月最后一天：month index 为 d.getMonth()+1、day 为 0
  const lastDay = new Date(nextYear, d.getMonth() + 1, 0).getDate()
  d.setFullYear(nextYear, d.getMonth(), Math.min(day, lastDay))
}

export function calculateNextRecurrence(iso: string, rule: RecurrenceRule): string {
  if (!rule || rule === 'none') return iso
  // 保留「全天 vs 带时间」：输入无时间则输出也仅日期
  const hasTime = /T\d/.test(iso)
  const date = parseIsoLocal(iso)
  if (!date) return iso

  switch (rule) {
    case 'daily':
      date.setDate(date.getDate() + 1)
      break
    case 'weekly':
      date.setDate(date.getDate() + 7)
      break
    case 'monthly':
      advanceMonth(date)
      break
    case 'yearly':
      advanceYear(date)
      break
  }
  return hasTime ? toIsoLocal(date) : toDateOnly(date)
}
