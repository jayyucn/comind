import type { CoreClient } from '../wasm/client'
import type { Notification, NotificationSettings, Block, Page } from '../wasm/types'
import { type DateRef, type DateRefKind, type RecurrenceRule } from '../utils/date-ref'
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

  async updateNotificationPayload(id: string, payload: string): Promise<Notification> {
    return this.client.updateNotificationPayload(id, payload)
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
        const storedRefs = await this.client.getDateRefsByBlock(block.id)
        const dateRefs: DateRef[] = storedRefs.map((r) => ({
          kind: r.kind as DateRefKind,
          iso: r.iso,
          recurrence: r.recurrence as RecurrenceRule,
          leadMinutes: r.lead_minutes,
        }))
        for (const dateRef of dateRefs) {
          const eventTime = this.calculateEventTime(dateRef)
          if (!eventTime) continue

          const effectiveTime = eventTime - (dateRef.leadMinutes || 0) * 60 * 1000

          // 全量回写 payload（不限时间）：block 内容改动后，未来日期的通知也立即同步，
          // 列表里立刻显示最新内容，不必等到事件发生才更新。dismissed 锚点跳过。
          await this.syncPayloadIfExists(block, page, dateRef, eventTime)

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

  private buildPayload(block: Block, page: Page, dateRef: DateRef, eventIso: string): NotificationPayload {
    const blockSnippet = block.content.replace(/\{\{[^}]+\}\}/g, '').trim().slice(0, 100)
    return {
      title: dateRef.kind === 'deadline' ? '截止日期提醒' : '日程提醒',
      body: blockSnippet || page.title,
      blockSnippet,
      eventDisplay: eventIso,
      blockId: block.id,
      pageId: page.id,
      pageTitle: page.title,
    }
  }

  private async fireNotification(block: Block, page: Page, dateRef: DateRef, eventTime: number): Promise<Notification | null> {
    const eventIso = new Date(eventTime).toISOString().slice(0, 16)

    const existing = await this.findExistingNotification(block.id, dateRef.kind, eventIso)
    if (existing) {
      // 已存在同 (block_id, kind, event_iso) 的通知：不重复创建。
      // - dismissed：用户已删除，直接跳过（软删除锚点，绝不重建/重吐）
      // - pending：转为 unread 让用户看到
      // - unread/read：回写最新 payload（block 内容可能被改过），避免通知显示旧快照
      // recurrence 场景下 event_iso 每轮不同，天然不会漏掉新一轮提醒。
      if (existing.status === 'dismissed') {
        console.log('[notif] fireNotification: skipped dismissed anchor', existing.id)
        return null
      }
      // payload 已由 syncPayloadIfExists 全量回写（含未到点的），此处不再重复写。
      if (existing.status === 'pending') {
        await this.client.updateNotificationStatus(existing.id, 'unread')
        existing.status = 'unread'
      }
      console.log('[notif] fireNotification: reusing existing', existing.id, 'status=', existing.status)
      return existing
    }

    const payload = this.buildPayload(block, page, dateRef, eventIso)

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

    console.log('[notif] fireNotification: CREATED new for', block.id, dateRef.kind, eventIso)
    return this.client.createNotification(notification)
  }

  // 对(已存在且未 dismissed 的)通知全量回写最新 payload。
  // 由 checkAndFire 在每个 dateRef 上调用，不限 effectiveTime，
  // 使 block 内容改动后，即使通知还没到点也会同步显示新内容。
  private async syncPayloadIfExists(block: Block, page: Page, dateRef: DateRef, eventTime: number): Promise<void> {
    const eventIso = new Date(eventTime).toISOString().slice(0, 16)
    const existing = await this.findExistingNotification(block.id, dateRef.kind, eventIso)
    if (!existing || existing.status === 'dismissed') {
      return
    }
    const payload = this.buildPayload(block, page, dateRef, eventIso)
    await this.client.updateNotificationPayload(existing.id, JSON.stringify(payload))
    console.log('[notif] syncPayloadIfExists: payload synced for', existing.id, 'status=', existing.status)
  }

  private async findExistingNotification(blockId: string, kind: string, eventIso: string): Promise<Notification | null> {
    const notifications = await this.client.getNotificationsByBlock(blockId)
    const found = notifications.find(n => n.kind === kind && n.event_iso === eventIso) || null
    console.log('[notif] findExistingNotification:', blockId, kind, eventIso, '-> candidates=', notifications.length, 'found=', found ? found.status : 'none')
    return found
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