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

  // next week / this week / last week? (maybe overkill for now)

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

export function parseDateInput(input: string): string | null {
  const trimmed = input.trim().toLowerCase()

  if (!trimmed) {
    return null
  }

  // 先尝试相对日期
  let date = parseRelativeDate(trimmed)
  if (date) {
    return formatDate(date)
  }

  // 然后尝试部分日期
  date = parsePartialDate(trimmed)
  if (date) {
    return formatDate(date)
  }

  return null
}
