import type { NotificationSettings } from '../wasm/types'

export type NotificationKind = 'schedule' | 'deadline' | 'overdue'
export type NotificationStatus = 'pending' | 'unread' | 'read' | 'dismissed'

export interface NotificationPayload {
  title: string
  body: string
  blockSnippet: string
  eventDisplay: string
  blockId: string
  pageId: string
  pageTitle: string
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  schedule_enabled: true,
  deadline_enabled: true,
  overdue_enabled: true,
  quiet_hours_start: null,
  quiet_hours_end: null,
  web_browser_notifications_enabled: false,
}

export const SNOOZE_PRESETS = {
  '10m': 10 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  tomorrow: -1,
} as const

export type SnoozePreset = keyof typeof SNOOZE_PRESETS

export const LEAD_TIME_OPTIONS = [0, 5, 15, 30, 60] as const
export type LeadTimeOption = typeof LEAD_TIME_OPTIONS[number]