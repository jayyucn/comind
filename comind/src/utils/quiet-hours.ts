import type { NotificationSettings } from '../wasm/types'

export function isQuietHours(settings: NotificationSettings): boolean {
  if (!settings.quiet_hours_start || !settings.quiet_hours_end) {
    return false
  }

  const now = new Date()
  const start = parseTime(settings.quiet_hours_start)
  const end = parseTime(settings.quiet_hours_end)

  if (!start || !end) {
    return false
  }

  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const startMinutes = start.hours * 60 + start.minutes
  const endMinutes = end.hours * 60 + end.minutes

  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes
  } else {
    return nowMinutes >= startMinutes || nowMinutes < endMinutes
  }
}

export function parseTime(timeStr: string): { hours: number; minutes: number } | null {
  const match = timeStr.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) {
    return null
  }

  const hours = parseInt(match[1], 10)
  const minutes = parseInt(match[2], 10)

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null
  }

  return { hours, minutes }
}

export function formatTime(hours: number, minutes: number): string {
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
}