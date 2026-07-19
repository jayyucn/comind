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
    // 过滤掉 dismissed（已删除）：软删除只改 status 不移除内存项，
    // 不在此过滤则删除后该项仍会渲染在列表里。
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
      // 立即从内存数组移除，确保 UI 列表实时消失（不依赖 sortedNotifications 的 filter 重算）
      notifications.value.splice(index, 1)
    }
    // 从 DB 重新拉取（query_recent 只含 unread/read，不含 dismissed），
    // 保证 UI 与 DB 完全一致，杜绝任何竞态/残留导致的"删除后还有"。
    await loadNotifications()
    await refreshUnreadCount()
  }

  async function triggerCheckAndFire() {
    const service = await getService()
    const fired = await service.checkAndFire(settings.value)

    for (const notif of fired) {
      const index = notifications.value.findIndex(n => n.id === notif.id)
      if (index === -1) {
        notifications.value.unshift(notif)

        const payload = JSON.parse(notif.payload) as NotificationPayload
        const delivery = getNotificationDelivery()
        delivery.notify(payload).catch(() => {})
      } else {
        // 内存中已有该通知：用 checkAndFire 返回的最新对象（含同步后的 payload / 状态）原地更新，
        // 否则 block 改过内容后，UI 仍显示旧的 notification 快照，直到下次 loadNotifications 才刷新。
        notifications.value[index] = notif
      }
    }

    // 角标以 DB 为准重算，避免多次 triggerCheckAndFire 累加导致虚高。
    // checkAndFire 返回的是 DB 里所有待提醒通知（含已存在的 unread），
    // 若在此累加会随触发次数增长，与实际未读数不符。
    await refreshUnreadCount()

    // 从 DB 重拉（query_recent 只含 unread/read）：syncPayloadIfExists 已把最新 payload 写回 DB，
    // 但那些「未到点」的通知不在 fired 中，内存数组的 payload 仍是旧快照，UI 会显示旧内容。
    // 重拉使内存与 DB 一致，block 改内容后通知列表立即显示最新文案。
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
