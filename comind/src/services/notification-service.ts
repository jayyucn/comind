import type { CoreClient } from '../wasm/client'
import type { Notification, NotificationSettings, Block, Page } from '../wasm/types'
import type { DateRefRecord } from '../wasm/types'
import { type DateRef, type DateRefKind, type RecurrenceRule } from '../utils/date-ref'
import { isQuietHours } from '../utils/quiet-hours'
import { DEFAULT_NOTIFICATION_SETTINGS, type NotificationPayload } from '../types/notification'

const CLEANUP_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

// 跨模块共享单例：store（checkAndFire 调度）与 block 编辑路径（syncPayloadForBlock）共用同一实例，
// 避免重复构造导致状态分裂。由首次 getNotificationService(client) 惰性创建。
let sharedService: NotificationService | null = null

export function getNotificationService(client: CoreClient): NotificationService {
  if (!sharedService) {
    sharedService = new NotificationService(client)
  }
  return sharedService
}

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

  // 性能优化后的 checkAndFire（方案 A/Q1-Q14 收敛）：
  // 不再每 60s 全量遍历 pages×blocks×dateRefs×(K 个通知)，
  // 改为：(1) 一次 DB 查询取「到期且非 recurring」的 dateRef；(2) 一次 DB 查询取全部 recurring（小集合）；
  //     (3) 仅对到期条目按 block_id 取 block/page/通知，触发 fireNotification。
  // 移除原「全量 syncPayloadIfExists 回写」——payload 同步改为编辑路径事件驱动（见 syncPayloadForBlock）。
  async checkAndFire(settings: NotificationSettings = DEFAULT_NOTIFICATION_SETTINGS): Promise<Notification[]> {
    if (!settings.enabled) {
      return []
    }

    if (isQuietHours(settings)) {
      return []
    }

    const now = Date.now()
    const firedNotifications: Notification[] = []

    // ===== Batch fetch all data in 1 IPC call =====
    // Returns: recurring dateRefs + due non-recurring dateRefs + their blocks + pages + existing notifications
    const batch = await this.client.batchCheckAndFireData(now)

    // Build lookup maps to avoid N×4 IPC calls
    const blockMap = new Map<string, Block>()
    for (const b of batch.blocks) blockMap.set(b.id, b)
    const pageMap = new Map<string, Page>()
    for (const p of batch.pages) pageMap.set(p.id, p)
    // Key: blockId|kind|eventIso → Notification
    const notifMap = new Map<string, Notification>()
    for (const n of batch.notifications) {
      notifMap.set(`${n.block_id}|${n.kind}|${n.event_iso}`, n)
    }

    // 1) 到期且非 recurring
    for (const r of batch.due_non_recurring) {
      const block = blockMap.get(r.block_id)
      if (!block) continue
      const page = pageMap.get(block.page_id)
      if (!page) continue
      const eventTime = r.event_ts
      if (!eventTime) continue
      const existing = notifMap.get(`${r.block_id}|${r.kind}|${r.iso}`) ?? null
      const notification = await this.fireNotification(block, page, r, eventTime, existing)
      if (notification) {
        firedNotifications.push(notification)
        // Update cache to reflect any status changes
        notifMap.set(`${r.block_id}|${r.kind}|${r.iso}`, notification)
      }
    }

    // 2) 全部 recurring：在 TS 侧算下一周期 eventTime
    for (const r of batch.recurring_refs) {
      const dateRef: DateRef = {
        kind: r.kind as DateRefKind,
        iso: r.iso,
        recurrence: r.recurrence as RecurrenceRule,
        leadMinutes: r.lead_minutes,
      }
      const eventTime = this.calculateEventTime(dateRef)
      if (!eventTime) continue
      const effectiveTime = eventTime - (dateRef.leadMinutes || 0) * 60 * 1000
      if (effectiveTime > now) continue
      const block = blockMap.get(r.block_id)
      if (!block) continue
      const page = pageMap.get(block.page_id)
      if (!page) continue
      const existing = notifMap.get(`${r.block_id}|${r.kind}|${r.iso}`) ?? null
      const notification = await this.fireNotification(block, page, r, eventTime, existing)
      if (notification) {
        firedNotifications.push(notification)
        notifMap.set(`${r.block_id}|${r.kind}|${r.iso}`, notification)
      }
    }

    await this.cleanupOldNotifications()
    return firedNotifications
  }

  // 编辑路径事件驱动：block 内容变更后，仅对该 block 同步其未 dismissed 通知的 payload。
  // 取代原 checkAndFire 内的「全量 syncPayloadIfExists 回写」，消除每 60s 的 N×M×K 次写。
  async syncPayloadForBlock(blockId: string): Promise<void> {
    const block = await this.client.getBlock(blockId)
    const page = await this.client.getPage(block.page_id)
    const storedRefs = await this.client.getDateRefsByBlock(blockId)
    const dateRefs: DateRef[] = storedRefs.map((r) => ({
      kind: r.kind as DateRefKind,
      iso: r.iso,
      recurrence: r.recurrence as RecurrenceRule,
      leadMinutes: r.lead_minutes,
    }))
    for (const dateRef of dateRefs) {
      const eventTime = this.calculateEventTime(dateRef)
      if (!eventTime) continue
      // 用 dateRef.iso 字面量（用户写的）作为 eventIso，与 block 渲染（formatIsoDisplay）一致，
      // 避免 toISOString 把本地时区 event_ts 转 UTC 字符串后再被前端当成本地时区解析的偏差。
      const eventIso = dateRef.iso
      const existing = await this.findExistingNotification(blockId, dateRef.kind, eventIso)
      if (!existing || existing.status === 'dismissed') {
        continue
      }
      const payload = this.buildPayload(block, page, dateRef, eventIso)
      await this.client.updateNotificationPayload(existing.id, JSON.stringify(payload))
      console.log('[notif] syncPayloadForBlock: payload synced for', existing.id)
    }
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

  private buildPayload(block: Block, page: Page, dateRef: DateRef | DateRefRecord, eventIso: string): NotificationPayload {
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

  private async fireNotification(block: Block, page: Page, dateRef: DateRef | DateRefRecord, _eventTime: number, existingIn: Notification | null): Promise<Notification | null> {
    // 用 dateRef.iso 字面量（用户写的）作为 eventIso：
    // - 写入 Notification.event_iso 字段（去重匹配用，与 syncPayloadForBlock 保持一致）
    // - 写入 payload.eventDisplay（前端 NotificationBell.formatEvent 用）
    // 这样 block 上显示什么、通知里就显示什么，零时区换算偏差。
    const eventIso = dateRef.iso

    // 调用方在 checkAndFire 中已查到 existing（复用锚点）；若未传则此处补查。
    const existing = existingIn ?? await this.findExistingNotification(block.id, dateRef.kind, eventIso)
    if (existing) {
      // 已存在同 (block_id, kind, event_iso) 的通知：不重复创建。
      // - dismissed：用户已删除，直接跳过（软删除锚点，绝不重建/重吐）
      // - pending：转为 unread 让用户看到
      // - unread/read：复用现有（payload 同步由 syncPayloadForBlock 事件驱动，此处不写）
      if (existing.status === 'dismissed') {
        console.log('[notif] fireNotification: skipped dismissed anchor', existing.id)
        return null
      }
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

  private async findExistingNotification(blockId: string, kind: string, eventIso: string): Promise<Notification | null> {
    const notifications = await this.client.getNotificationsByBlock(blockId)
    const found = notifications.find(n => n.kind === kind && n.event_iso === eventIso) || null
    console.log('[notif] findExistingNotification:', blockId, kind, eventIso, '-> candidates=', notifications.length, 'found=', found ? found.status : 'none')
    return found
  }
}

// 同步读取（localStorage 本身同步）：供 store 初始化时立即拿到真实设置，
// 避免 enabled=false 时铃铛先按默认 true 渲染、异步 loadSettings 后才消失的闪现。
export function loadNotificationSettingsSync(): NotificationSettings {
  try {
    const stored = localStorage.getItem('comind-notification-settings')
    if (stored) {
      return { ...DEFAULT_NOTIFICATION_SETTINGS, ...JSON.parse(stored) }
    }
  } catch {
  }
  return { ...DEFAULT_NOTIFICATION_SETTINGS }
}

export async function loadNotificationSettings(): Promise<NotificationSettings> {
  return loadNotificationSettingsSync()
}

export async function saveNotificationSettings(settings: NotificationSettings): Promise<void> {
  localStorage.setItem('comind-notification-settings', JSON.stringify(settings))
}