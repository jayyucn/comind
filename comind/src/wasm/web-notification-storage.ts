import Dexie from 'dexie'
import type { Notification } from './types'

class NotificationDB extends Dexie {
  notifications!: Dexie.Table<NotificationRecord, string>

  constructor() {
    super('comind-notifications')
    this.version(1).stores({
      notifications: 'id, block_id, status, fired_at, updated_at'
    })
  }
}

interface NotificationRecord {
  id: string
  block_id: string
  page_id: string
  kind: string
  event_iso: string
  fired_at: number
  status: string
  snooze_until: number | null
  payload: string
  created_at: number
  updated_at: number
}

const notificationDb = new NotificationDB()

export async function getWebNotification(id: string): Promise<Notification> {
  const record = await notificationDb.notifications.get(id)
  if (!record) {
    throw new Error(`Notification not found: ${id}`)
  }
  return record
}

export async function getWebNotificationsByBlock(blockId: string): Promise<Notification[]> {
  return notificationDb.notifications
    .where('block_id')
    .equals(blockId)
    .reverse()
    .sortBy('fired_at')
}

export async function findWebNotificationByEvent(blockId: string, kind: string, event_iso: string): Promise<Notification | null> {
  const records = await notificationDb.notifications
    .where('block_id')
    .equals(blockId)
    .and(n => n.kind === kind && n.event_iso === event_iso)
    .limit(1)
    .toArray()
  return records.length > 0 ? records[0] : null
}

export async function queryWebUnreadNotifications(): Promise<Notification[]> {
  return notificationDb.notifications
    .where('status')
    .equals('unread')
    .reverse()
    .sortBy('fired_at')
}

export async function queryWebPendingDue(nowMs: number): Promise<Notification[]> {
  return notificationDb.notifications
    .where('status')
    .equals('pending')
    .and(n => n.snooze_until !== null && n.snooze_until <= nowMs)
    .sortBy('snooze_until')
}

export async function queryWebRecentNotifications(limit: number): Promise<Notification[]> {
  return notificationDb.notifications
    .where('status')
    .anyOf(['unread', 'read'])
    .reverse()
    .sortBy('fired_at')
    .then(notifications => notifications.slice(0, limit))
}

export async function createWebNotification(notification: Notification): Promise<Notification> {
  await notificationDb.notifications.put(notification)
  return notification
}

export async function batchCreateWebNotifications(notifications: Notification[]): Promise<Notification[]> {
  await notificationDb.notifications.bulkPut(notifications)
  return notifications
}

export async function updateWebNotificationStatus(id: string, status: string): Promise<Notification> {
  const record = await notificationDb.notifications.get(id)
  if (!record) {
    throw new Error(`Notification not found: ${id}`)
  }
  const updated = { ...record, status, updated_at: Date.now() }
  await notificationDb.notifications.put(updated)
  return updated
}

export async function setWebNotificationSnooze(id: string, snoozeUntil: number, status: string): Promise<Notification> {
  const record = await notificationDb.notifications.get(id)
  if (!record) {
    throw new Error(`Notification not found: ${id}`)
  }
  const updated = { ...record, snooze_until: snoozeUntil, status, updated_at: Date.now() }
  await notificationDb.notifications.put(updated)
  return updated
}

export async function deleteWebNotification(id: string): Promise<void> {
  await notificationDb.notifications.delete(id)
}

export async function cleanupWebNotifications(timestamp: number): Promise<void> {
  await notificationDb.notifications
    .where('status')
    .anyOf(['read', 'dismissed'])
    .and(n => n.updated_at < timestamp)
    .delete()
}

export async function markAllWebNotificationsRead(): Promise<void> {
  const unread = await notificationDb.notifications.where('status').equals('unread').toArray()
  const updated = unread.map(n => ({ ...n, status: 'read' as const, updated_at: Date.now() }))
  await notificationDb.notifications.bulkPut(updated)
}