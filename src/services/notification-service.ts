import type { CoreClient } from '../wasm/client'
import type { Notification, NotificationSettings } from '../wasm/types'
import { DEFAULT_NOTIFICATION_SETTINGS } from '../types/notification'

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

  // ===== Migrated to Rust =====
  // All business logic (recurrence calculation, quiet-hours, dedup anchoring,
  // buildPayload, fireNotification) is now in comind-core NotificationService.

  async checkAndFire(_settings: NotificationSettings = DEFAULT_NOTIFICATION_SETTINGS): Promise<Notification[]> {
    return this.client.checkAndFire()
  }

  async syncPayloadForBlock(blockId: string): Promise<void> {
    return this.client.syncPayloadForBlock(blockId)
  }
}

// ===== Notification Settings (migrated to Rust SQLite) =====

// Sync fallback for store init: returns defaults until async load completes.
// Real settings are loaded from Rust via getNotificationSettings (reads cached in-memory config).
export function loadNotificationSettingsSync(): NotificationSettings {
  return { ...DEFAULT_NOTIFICATION_SETTINGS }
}

export async function loadNotificationSettings(client: CoreClient): Promise<NotificationSettings> {
  try {
    return await client.getNotificationSettings()
  } catch {
    return { ...DEFAULT_NOTIFICATION_SETTINGS }
  }
}

export async function saveNotificationSettings(client: CoreClient, settings: NotificationSettings): Promise<void> {
  await client.saveNotificationSettings(settings)
}
