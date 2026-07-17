import type { CoreClient } from '../wasm/client'
import type { Notification, NotificationSettings, Block, Page } from '../wasm/types'
import { parseDateRefs, type DateRef } from '../utils/date-ref'
import { isQuietHours } from '../utils/quiet-hours'
import { DEFAULT_NOTIFICATION_SETTINGS, type NotificationPayload } from '../types/notification'

const CLEANUP_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export class NotificationService {
  private client: CoreClient

  constructor(client: CoreClient) {
    this.client = client
  }

  async getUnreadCount(): Promise<number> {
    const notifications = await this.client.queryUnreadNotifications()
    return notifications.length
  }

  async getRecentNotifications(limit: number = 50): Promise<Notification[]> {
    return this.client.queryRecentNotifications(limit)
  }

  async getNotificationsByBlock(blockId: string): Promise<Notification[]> {
    return this.client.getNotificationsByBlock(blockId)
  }

  async getNotification(id: string): Promise<Notification> {
    return this.client.getNotification(id)
  }

  async markAsRead(id: string): Promise<Notification> {
    return this.client.updateNotificationStatus(id, 'read')
  }

  async dismiss(id: string): Promise<Notification> {
    return this.client.updateNotificationStatus(id, 'dismissed')
  }

  async markAllRead(): Promise<void> {
    await this.client.markAllNotificationsRead()
  }

  async snooze(id: string, minutes: number): Promise<Notification> {
    const snoozeUntil = Date.now() + minutes * 60 * 1000
    return this.client.setNotificationSnooze(id, snoozeUntil, 'pending')
  }

  async delete(id: string): Promise<void> {
    await this.client.deleteNotification(id)
  }

  async cleanupOldNotifications(): Promise<void> {
    const cutoffTime = Date.now() - CLEANUP_RETENTION_MS
    await this.client.cleanupNotifications(cutoffTime)
  }

  async checkAndFire(settings: NotificationSettings = DEFAULT_NOTIFICATION_SETTINGS): Promise<Notification[]> {
    if (!settings.enabled) {
      return []
    }

    if (isQuietHours(settings)) {
      return []
    }

    const now = Date.now()
    const firedNotifications: Notification[] = []

    const pages = await this.client.getAllPages()
    for (const page of pages) {
      const blocks = await this.client.getBlocksByPage(page.id)
      for (const block of blocks) {
        const dateRefs = parseDateRefs(block.content)
        for (const dateRef of dateRefs) {
          const eventTime = this.calculateEventTime(dateRef)
          if (!eventTime) continue

          const effectiveTime = eventTime - (dateRef.leadMinutes || 0) * 60 * 1000

          if (effectiveTime <= now) {
            const notification = await this.fireNotification(block, page, dateRef, eventTime)
            if (notification) {
              firedNotifications.push(notification)
            }
          }
        }
      }
    }

    await this.cleanupOldNotifications()
    return firedNotifications
  }

  private calculateEventTime(dateRef: DateRef): number | null {
    const baseDate = new Date(dateRef.iso)
    if (isNaN(baseDate.getTime())) {
      return null
    }

    baseDate.setHours(9, 0, 0, 0)

    if (dateRef.recurrence === 'none' || !dateRef.recurrence) {
      return baseDate.getTime()
    }

    const now = new Date()
    const baseTimestamp = baseDate.getTime()
    const nowTimestamp = now.getTime()

    if (baseTimestamp > nowTimestamp) {
      return baseTimestamp
    }

    const dayMs = 24 * 60 * 60 * 1000

    switch (dateRef.recurrence) {
      case 'daily': {
        const daysDiff = Math.ceil((nowTimestamp - baseTimestamp) / dayMs)
        return baseTimestamp + daysDiff * dayMs
      }
      case 'weekly': {
        const weekMs = 7 * dayMs
        const weeksDiff = Math.ceil((nowTimestamp - baseTimestamp) / weekMs)
        return baseTimestamp + weeksDiff * weekMs
      }
      case 'monthly': {
        let result = new Date(baseDate)
        while (result.getTime() <= nowTimestamp) {
          const nextMonth = result.getMonth() + 1
          result.setMonth(nextMonth)
        }
        return result.getTime()
      }
      case 'yearly': {
        let result = new Date(baseDate)
        while (result.getTime() <= nowTimestamp) {
          result.setFullYear(result.getFullYear() + 1)
        }
        return result.getTime()
      }
      default:
        return baseTimestamp
    }
  }

  private async fireNotification(block: Block, page: Page, dateRef: DateRef, eventTime: number): Promise<Notification | null> {
    const eventIso = new Date(eventTime).toISOString().slice(0, 16)

    const existing = await this.findExistingNotification(block.id, dateRef.kind, eventIso)
    if (existing) {
      if (existing.status === 'pending') {
        await this.client.updateNotificationStatus(existing.id, 'unread')
        return existing
      }
      return null
    }

    const payload: NotificationPayload = {
      title: dateRef.kind === 'deadline' ? '截止日期提醒' : '日程提醒',
      body: block.content.replace(/\{\{[^}]+\}\}/g, '').trim() || page.title,
      pageId: page.id,
      blockId: block.id,
      pageTitle: page.title,
      blockContent: block.content.replace(/\{\{[^}]+\}\}/g, '').trim(),
    }

    const notification: Notification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      block_id: block.id,
      page_id: page.id,
      kind: dateRef.kind,
      event_iso: eventIso,
      fired_at: Date.now(),
      status: 'unread',
      snooze_until: null,
      payload: JSON.stringify(payload),
      created_at: Date.now(),
      updated_at: Date.now(),
    }

    return this.client.createNotification(notification)
  }

  private async findExistingNotification(blockId: string, kind: string, eventIso: string): Promise<Notification | null> {
    const notifications = await this.client.getNotificationsByBlock(blockId)
    return notifications.find(n => n.kind === kind && n.event_iso === eventIso) || null
  }
}

export async function loadNotificationSettings(): Promise<NotificationSettings> {
  try {
    const stored = localStorage.getItem('comind-notification-settings')
    if (stored) {
      return { ...DEFAULT_NOTIFICATION_SETTINGS, ...JSON.parse(stored) }
    }
  } catch {
  }
  return { ...DEFAULT_NOTIFICATION_SETTINGS }
}

export async function saveNotificationSettings(settings: NotificationSettings): Promise<void> {
  localStorage.setItem('comind-notification-settings', JSON.stringify(settings))
}