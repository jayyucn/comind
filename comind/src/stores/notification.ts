import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Notification, NotificationSettings } from '../wasm/types'
import type { NotificationPayload } from '../types/notification'
import { SNOOZE_PRESETS } from '../types/notification'
import { NotificationService, loadNotificationSettings, loadNotificationSettingsSync, saveNotificationSettings, getNotificationService } from '../services/notification-service'
import { getNotificationDelivery } from '../services/notification-delivery'
import { initCoreClient } from '../wasm/client'

let coreClientPromise: ReturnType<typeof initCoreClient> | null = null

async function getClient() {
  if (!coreClientPromise) {
    coreClientPromise = initCoreClient()
  }
  return coreClientPromise
}

async function getService(): Promise<NotificationService> {
  const client = await getClient()
  return getNotificationService(client)
}

export const useNotificationStore = defineStore('notification', () => {
  const notifications = ref<Notification[]>([])
  const settings = ref<NotificationSettings>(loadNotificationSettingsSync())
  const unreadCount = ref(0)
  const isLoading = ref(false)

  const sortedNotifications = computed(() => {
    return notifications.value
      .filter(n => n.status !== 'dismissed')
      .sort((a, b) => b.fired_at - a.fired_at)
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
    const client = await getClient()
    settings.value = await loadNotificationSettings(client)
  }

  async function saveSettings(newSettings: NotificationSettings) {
    settings.value = newSettings
    const client = await getClient()
    await saveNotificationSettings(client, newSettings)
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
    const index = notifications.value.findIndex(n => n.id === id)
    const service = await getService()
    const updated = await service.markAsRead(id)
    if (index !== -1) {
      notifications.value[index] = updated
    }
    await refreshUnreadCount()
  }

  async function markAllRead() {
    const service = await getService()
    await service.markAllRead()
    for (const n of notifications.value) {
      if (n.status === 'unread') {
        n.status = 'read'
      }
    }
    await refreshUnreadCount()
  }

  async function snooze(id: string, minutes: number) {
    const index = notifications.value.findIndex(n => n.id === id)
    const service = await getService()
    const updated = await service.snooze(id, minutes)
    if (index !== -1) {
      notifications.value[index] = updated
    }
    await refreshUnreadCount()
  }

  async function deleteNotification(id: string) {
    const index = notifications.value.findIndex(n => n.id === id)
    const service = await getService()
    // 软删除：置为 dismissed 而非物理删除。
    // 保留记录作为 checkAndFire 的去重锚点，避免删除后 dateRef 仍在导致重建。
    // query_recent 只返回 unread/read，dismissed 不显示，视觉即"已删除"。
    const updated = await service.dismiss(id)
    console.log('[notif] deleteNotification: dismissed', id, '-> status=', updated.status)
    if (index !== -1) {
      notifications.value.splice(index, 1)
    }
    await loadNotifications()
    await refreshUnreadCount()
  }

  async function triggerCheckAndFire() {
    const service = await getService()
    const fired = await service.checkAndFire()

    for (const notif of fired) {
      const index = notifications.value.findIndex(n => n.id === notif.id)
      if (index === -1) {
        notifications.value.unshift(notif)

        const payload = JSON.parse(notif.payload) as NotificationPayload
        const delivery = getNotificationDelivery()
        delivery.notify(payload).catch(() => {})
      } else {
        notifications.value[index] = notif
      }
    }

    await refreshUnreadCount()
    await loadNotifications()
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

  async function toggleSetting(key: keyof NotificationSettings) {
    const value = settings.value[key]
    if (typeof value === 'boolean') {
      (settings.value as unknown as Record<string, boolean>)[key] = !value
      const client = await getClient()
      await saveNotificationSettings(client, settings.value)
    }
  }

  async function updateSetting<K extends keyof NotificationSettings>(key: K, value: NotificationSettings[K]) {
    settings.value[key] = value
    const client = await getClient()
    await saveNotificationSettings(client, settings.value)
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
