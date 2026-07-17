import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Notification, NotificationSettings } from '../wasm/types'
import type { NotificationPayload } from '../types/notification'
import { DEFAULT_NOTIFICATION_SETTINGS, SNOOZE_PRESETS } from '../types/notification'
import { NotificationService, loadNotificationSettings, saveNotificationSettings } from '../services/notification-service'
import { getNotificationDelivery } from '../services/notification-delivery'
import { initCoreClient } from '../wasm/client'

let coreClientPromise: ReturnType<typeof initCoreClient> | null = null

async function getClient() {
  if (!coreClientPromise) {
    coreClientPromise = initCoreClient()
  }
  return coreClientPromise
}

let notificationService: NotificationService | null = null

async function getService(): Promise<NotificationService> {
  if (!notificationService) {
    const client = await getClient()
    notificationService = new NotificationService(client)
  }
  return notificationService
}

export const useNotificationStore = defineStore('notification', () => {
  const notifications = ref<Notification[]>([])
  const settings = ref<NotificationSettings>({ ...DEFAULT_NOTIFICATION_SETTINGS })
  const unreadCount = ref(0)
  const isLoading = ref(false)

  const sortedNotifications = computed(() => {
    return [...notifications.value].sort((a, b) => b.fired_at - a.fired_at)
  })

  const groupedNotifications = computed(() => {
    const groups: { date: string; items: Notification[] }[] = []

    for (const notif of sortedNotifications.value) {
      const notifDate = new Date(notif.fired_at).toDateString()
      let group = groups.find(g => g.date === notifDate)

      if (!group) {
        group = { date: notifDate, items: [] }
        groups.push(group)
      }
      group.items.push(notif)
    }

    return groups
  })

  async function loadSettings() {
    settings.value = await loadNotificationSettings()
  }

  async function saveSettings(newSettings: NotificationSettings) {
    settings.value = newSettings
    await saveNotificationSettings(newSettings)
  }

  async function loadNotifications() {
    isLoading.value = true
    try {
      const service = await getService()
      notifications.value = await service.getRecentNotifications(50)
      unreadCount.value = await service.getUnreadCount()
    } finally {
      isLoading.value = false
    }
  }

  async function refreshUnreadCount() {
    const service = await getService()
    unreadCount.value = await service.getUnreadCount()
  }

  async function markAsRead(id: string) {
    const service = await getService()
    const updated = await service.markAsRead(id)
    const index = notifications.value.findIndex(n => n.id === id)
    if (index !== -1) {
      notifications.value[index] = updated
    }
    unreadCount.value = Math.max(0, unreadCount.value - 1)
  }

  async function dismiss(id: string) {
    const service = await getService()
    const updated = await service.dismiss(id)
    const index = notifications.value.findIndex(n => n.id === id)
    if (index !== -1) {
      notifications.value[index] = updated
    }
    unreadCount.value = Math.max(0, unreadCount.value - 1)
  }

  async function markAllRead() {
    const service = await getService()
    await service.markAllRead()
    for (const n of notifications.value) {
      if (n.status === 'unread') {
        n.status = 'read'
      }
    }
    unreadCount.value = 0
  }

  async function snooze(id: string, minutes: number) {
    const service = await getService()
    const updated = await service.snooze(id, minutes)
    const index = notifications.value.findIndex(n => n.id === id)
    if (index !== -1) {
      notifications.value[index] = updated
    }
    unreadCount.value = Math.max(0, unreadCount.value - 1)
  }

  async function deleteNotification(id: string) {
    const service = await getService()
    await service.delete(id)
    const index = notifications.value.findIndex(n => n.id === id)
    if (index !== -1) {
      notifications.value.splice(index, 1)
    }
  }

  async function triggerCheckAndFire() {
    const service = await getService()
    const fired = await service.checkAndFire(settings.value)

    for (const notif of fired) {
      const existing = notifications.value.find(n => n.id === notif.id)
      if (!existing) {
        notifications.value.unshift(notif)
        unreadCount.value++

        const payload = JSON.parse(notif.payload) as NotificationPayload
        const delivery = getNotificationDelivery()
        delivery.notify(payload).catch(() => {})
      }
    }
  }

  function parsePayload(payloadStr: string): NotificationPayload {
    try {
      return JSON.parse(payloadStr) as NotificationPayload
    } catch {
      return {
        title: '通知',
        body: '',
        blockSnippet: '',
        eventDisplay: '',
        blockId: '',
        pageId: '',
        pageTitle: '',
      }
    }
  }

  function toggleSetting(key: keyof NotificationSettings) {
    const value = settings.value[key]
    if (typeof value === 'boolean') {
      (settings.value as unknown as Record<string, boolean>)[key] = !value
      saveNotificationSettings(settings.value)
    }
  }

  function updateSetting<K extends keyof NotificationSettings>(key: K, value: NotificationSettings[K]) {
    settings.value[key] = value
    saveNotificationSettings(settings.value)
  }

  return {
    notifications,
    settings,
    unreadCount,
    isLoading,
    sortedNotifications,
    groupedNotifications,
    loadSettings,
    saveSettings,
    loadNotifications,
    refreshUnreadCount,
    markAsRead,
    dismiss,
    markAllRead,
    snooze,
    deleteNotification,
    triggerCheckAndFire,
    parsePayload,
    toggleSetting,
    updateSetting,
    SNOOZE_PRESETS,
  }
})