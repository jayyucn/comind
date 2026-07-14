/**
 * 日期/时间解析
 *
 * 原有能力（保留）：
 *   parseDateInput(input) → 'YYYY-MM-DD' | null
 * 新增能力（本次扩展）：
 *   parseDateTimeInput(input) → { date, time? } | null   （日期 + 时间，支持中文）
 *   combineDateTime(result)    → 'YYYY-MM-DDTHH:mm' | 'YYYY-MM-DD'
 *   parseDateInput 内部改用统一的 resolveDate，从而也支持星期（下周一 / 周一）
 */

export function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseRelativeDate(input: string): Date | null {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // today / 今天
  if (/^today|今天$/.test(input)) {
    return today
  }

  // tomorrow / 明天
  if (/^tomorrow|明天$/.test(input)) {
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    return tomorrow
  }

  // yesterday / 昨天
  if (/^yesterday|昨天$/.test(input)) {
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    return yesterday
  }

  // +N days / -N days / N days later / N days ago
  const relativeDayMatch = input.match(/^([+-]?\d+)\s*(d|day|days)?$/)
  if (relativeDayMatch) {
    const days = parseInt(relativeDayMatch[1], 10)
    const result = new Date(today)
    result.setDate(result.getDate() + days)
    return result
  }

  return null
}

function parsePartialDate(input: string): Date | null {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // MM-DD
  const mmddMatch = input.match(/^(\d{1,2})-(\d{1,2})$/)
  if (mmddMatch) {
    const month = parseInt(mmddMatch[1], 10) - 1
    const day = parseInt(mmddMatch[2], 10)

    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const result = new Date(today.getFullYear(), month, day)
      // 如果日期已经过去了，我们假设是明年
      if (result < today) {
        result.setFullYear(result.getFullYear() + 1)
      }
      return result
    }
  }

  // YYYY-MM-DD
  const yyyymmddMatch = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (yyyymmddMatch) {
    const year = parseInt(yyyymmddMatch[1], 10)
    const month = parseInt(yyyymmddMatch[2], 10) - 1
    const day = parseInt(yyyymmddMatch[3], 10)

    if (year >= 2000 && year <= 2100 && month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      return new Date(year, month, day)
    }
  }

  return null
}

const WEEKDAYS: Record<string, number> = {
  日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6,
}

/** 解析星期：周一 / 下周一 / 星期三 / 下周日 */
function parseWeekday(input: string): Date | null {
  const m = input.match(/^(下?周|下?星期)([日天一二三四五六])$/)
  if (!m) return null
  const target = WEEKDAYS[m[2]]
  const isNextWeek = m[1].startsWith('下')
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // 本周的该星期
  const thisWeek = new Date(today)
  const back = (today.getDay() - target + 7) % 7
  thisWeek.setDate(today.getDate() - back)

  if (isNextWeek) {
    thisWeek.setDate(thisWeek.getDate() + 7)
  } else if (thisWeek.getTime() <= today.getTime()) {
    // 不含今天：若本周该星期已过（或就是今天），顺延到下周
    thisWeek.setDate(thisWeek.getDate() + 7)
  }
  return thisWeek
}

/** 统一的日期解析：相对 → 部分 → 星期 */
function resolveDate(input: string): Date | null {
  return parseRelativeDate(input) || parsePartialDate(input) || parseWeekday(input)
}

/**
 * 提取时间部分，返回 { time: 'HH:mm', rest: 剩余文本 }
 * 支持：14:00 / 9:30 / 下午2点 / 早上9点半 / 中午12点
 */
function extractTime(input: string): { time: string; rest: string } | null {
  const pad = (n: number) => String(n).padStart(2, '0')
  const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n))

  // 数字时间 14:00 / 9:30
  const numMatch = input.match(/(\d{1,2})[:：](\d{2})/)
  if (numMatch) {
    const h = clamp(parseInt(numMatch[1], 10), 23)
    const min = clamp(parseInt(numMatch[2], 10), 59)
    return { time: `${pad(h)}:${pad(min)}`, rest: input.replace(numMatch[0], '') }
  }

  // 中文时间：下午2点 / 早上9点半 / 下午2点30分 / 中午12点
  const cnMatch = input.match(/(早上|上午|中午|下午|晚上|凌晨)?\s*(\d{1,2})\s*点\s*(半|(\d{1,2})\s*分?)?/)
  if (cnMatch) {
    let h = parseInt(cnMatch[2], 10)
    const period = cnMatch[1]
    if (period === '下午' || period === '晚上') {
      if (h < 12) h += 12
    } else if (period === '中午') {
      h = 12
    } else if (period === '凌晨') {
      if (h === 12) h = 0
    }
    let min = 0
    if (cnMatch[3] === '半') min = 30
    else if (cnMatch[4]) min = parseInt(cnMatch[4], 10)
    return { time: `${pad(h)}:${pad(min)}`, rest: input.replace(cnMatch[0], '') }
  }

  return null
}

export interface DateTimeResult {
  /** YYYY-MM-DD */
  date: string
  /** HH:mm（可选，缺省表示全天） */
  time?: string
}

/** 日期 + 时间联合解析，输出本地结构 */
export function parseDateTimeInput(input: string): DateTimeResult | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const timeInfo = extractTime(trimmed)
  const datePart = (timeInfo?.rest ?? trimmed).trim()

  const date = resolveDate(datePart)
  if (!date) return null

  const result: DateTimeResult = { date: formatDate(date) }
  if (timeInfo?.time) result.time = timeInfo.time
  return result
}

/** DateTimeResult → 本地 ISO（2026-07-15T14:00 或 2026-07-15） */
export function combineDateTime(result: DateTimeResult): string {
  return result.time ? `${result.date}T${result.time}` : result.date
}

/** 仅解析日期（沿用旧行为，并额外支持星期） */
export function parseDateInput(input: string): string | null {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed) return null
  const date = resolveDate(trimmed)
  return date ? formatDate(date) : null
}
