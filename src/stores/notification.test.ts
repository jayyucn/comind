import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useNotificationStore } from './notification'
import { DEFAULT_NOTIFICATION_SETTINGS, SNOOZE_PRESETS } from '../types/notification'
import type { Notification } from '../wasm/types'

// ── Mock helpers ──────────────────────────────────────────

function makeNotification(partial: Partial<Notification> & { id: string }): Notification {
  return {
    id: partial.id,
    block_id: partial.block_id ?? 'block-1',
    page_id: partial.page_id ?? 'page-1',
    kind: partial.kind ?? 'schedule',
    event_iso: partial.event_iso ?? '2026-08-09T10:00',
    fired_at: partial.fired_at ?? Date.now() - 3600_000,
    status: partial.status ?? 'unread',
    snooze_until: partial.snooze_until ?? null,
    payload: partial.payload ?? JSON.stringify({
      title: '通知标题',
      body: '通知内容',
      blockSnippet: '片段',
      eventDisplay: '10:00',
      blockId: 'block-1',
      pageId: 'page-1',
      pageTitle: '页面标题',
    }),
    created_at: partial.created_at ?? 0,
    updated_at: partial.updated_at ?? 0,
  }
}

interface ClientMock {
  getNotificationSettings: ReturnType<typeof vi.fn>
  setNotificationSettings: ReturnType<typeof vi.fn>
  queryUnreadNotifications: ReturnType<typeof vi.fn>
  queryRecentNotifications: ReturnType<typeof vi.fn>
  getUnreadCount: ReturnType<typeof vi.fn>
  updateNotificationStatus: ReturnType<typeof vi.fn>
  markAllNotificationsRead: ReturnType<typeof vi.fn>
  setNotificationSnooze: ReturnType<typeof vi.fn>
  checkAndFire: ReturnType<typeof vi.fn>
  syncPayloadForBlock: ReturnType<typeof vi.fn>
}

function makeClientMock(): ClientMock {
  return {
    getNotificationSettings: vi.fn().mockResolvedValue({ ...DEFAULT_NOTIFICATION_SETTINGS }),
    setNotificationSettings: vi.fn().mockResolvedValue(undefined),
    queryUnreadNotifications: vi.fn().mockResolvedValue([]),
    queryRecentNotifications: vi.fn().mockResolvedValue([]),
    getUnreadCount: vi.fn().mockResolvedValue(0),
    updateNotificationStatus: vi.fn().mockImplementation(async (id, status) =>
      makeNotification({ id, status: status as Notification['status'] })
    ),
    markAllNotificationsRead: vi.fn().mockResolvedValue(undefined),
    setNotificationSnooze: vi.fn().mockImplementation(async (id, snoozeUntil, _status) =>
      makeNotification({ id, snooze_until: snoozeUntil, status: 'pending' })
    ),
    checkAndFire: vi.fn().mockResolvedValue([]),
    syncPayloadForBlock: vi.fn().mockResolvedValue(undefined),
  }
}

function setupServiceMock(clientMock: ClientMock) {
  // 由于 notification-service 使用了动态 import 和共享单例模式，
  // 这里通过 mock wasm/client 的 initCoreClient 来注入 mock client
  vi.doMock('../wasm/client', () => ({
    initCoreClient: vi.fn().mockResolvedValue(clientMock),
  }))

  // 同时 mock notification-service 的工厂函数，避免真实单例状态污染
  vi.doMock('../services/notification-service', () => {
    const actual = vi.importActual('../services/notification-service')
    return {
      ...actual,
      getNotificationService: vi.fn().mockImplementation(() => ({
        getUnreadCount: clientMock.getUnreadCount,
        getRecentNotifications: clientMock.queryRecentNotifications,
        markAsRead: (id: string) => clientMock.updateNotificationStatus(id, 'read'),
        markAllRead: clientMock.markAllNotificationsRead,
        snooze: (id: string, minutes: number) =>
          clientMock.setNotificationSnooze(id, Date.now() + minutes * 60_000, 'pending'),
        dismiss: (id: string) => clientMock.updateNotificationStatus(id, 'dismissed'),
        checkAndFire: clientMock.checkAndFire,
        syncPayloadForBlock: clientMock.syncPayloadForBlock,
      })),
      loadNotificationSettings: clientMock.getNotificationSettings,
      loadNotificationSettingsSync: () => ({ ...DEFAULT_NOTIFICATION_SETTINGS }),
      saveNotificationSettings: clientMock.setNotificationSettings,
    }
  })

  // 同理 mock notification-delivery（不真正发通知）
  vi.doMock('../services/notification-delivery', () => ({
    getNotificationDelivery: vi.fn().mockReturnValue({
      notify: vi.fn().mockResolvedValue(undefined),
    }),
  }))
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetModules()
})

// ============================================================
// 初始状态 & 计算属性
// ============================================================
describe('初始状态与计算属性', () => {
  it('初始化后 notifications 为空数组，unreadCount 为 0，settings 为默认值', async () => {
    setupServiceMock(makeClientMock())
    // 动态 import 以确保 doMock 生效
    const { useNotificationStore: useStore } = await import('./notification')
    const store = useStore()

    expect(store.notifications).toEqual([])
    expect(store.unreadCount).toBe(0)
    expect(store.isLoading).toBe(false)
    expect(store.settings).toEqual({ ...DEFAULT_NOTIFICATION_SETTINGS })
    expect(store.SNOOZE_PRESETS).toBe(SNOOZE_PRESETS)
  })

  it('sortedNotifications 过滤 dismissed 并按 fired_at 倒序', async () => {
    setupServiceMock(makeClientMock())
    const { useNotificationStore: useStore } = await import('./notification')
    const store = useStore()

    const n1 = makeNotification({ id: 'n1', status: 'unread', fired_at: 1000 })
    const n2 = makeNotification({ id: 'n2', status: 'read', fired_at: 3000 })
    const n3 = makeNotification({ id: 'n3', status: 'dismissed', fired_at: 2000 })

    store.notifications = [n1, n2, n3]

    // 应排除 dismissed，按 fired_at 倒序：n2(3000) → n1(1000)
    expect(store.sortedNotifications.map(n => n.id)).toEqual(['n2', 'n1'])
  })

  it('groupedNotifications 按日期分组，每组按 fired_at 倒序', async () => {
    setupServiceMock(makeClientMock())
    const { useNotificationStore: useStore } = await import('./notification')
    const store = useStore()

    const aug8 = new Date(2026, 7, 8, 10, 0, 0, 0).getTime()
    const aug9a = new Date(2026, 7, 9, 9, 0, 0, 0).getTime()
    const aug9b = new Date(2026, 7, 9, 14, 0, 0, 0).getTime()

    store.notifications = [
      makeNotification({ id: 'old', fired_at: aug8, status: 'unread' }),
      makeNotification({ id: 'mor', fired_at: aug9a, status: 'unread' }),
      makeNotification({ id: 'eve', fired_at: aug9b, status: 'read' }),
    ]

    const groups = store.groupedNotifications
    expect(groups.length).toBe(2)

    // 8月9日组应该包含 2 条，且 14:00 (eve) 在 9:00 (mor) 之前
    const aug9Group = groups.find(g => g.date === new Date(aug9b).toDateString())
    expect(aug9Group).toBeDefined()
    expect(aug9Group!.items.map(n => n.id)).toEqual(['eve', 'mor'])

    const aug8Group = groups.find(g => g.date === new Date(aug8).toDateString())
    expect(aug8Group).toBeDefined()
    expect(aug8Group!.items.map(n => n.id)).toEqual(['old'])
  })
})

// ============================================================
// parsePayload - JSON 解析与异常兜底
// Commit: 8069a35 - 通知系统重构
// ============================================================
describe('parsePayload - payload 解析', () => {
  it('合法 JSON 字符串正确解析', async () => {
    setupServiceMock(makeClientMock())
    const { useNotificationStore: useStore } = await import('./notification')
    const store = useStore()

    const payload = {
      title: '会议提醒',
      body: '3 点开会',
      blockSnippet: '准备材料',
      eventDisplay: '15:00',
      blockId: 'b-1',
      pageId: 'p-1',
      pageTitle: '工作计划',
    }
    const result = store.parsePayload(JSON.stringify(payload))
    expect(result).toEqual(payload)
  })

  it('损坏的 JSON 返回兜底默认值，不抛出异常', async () => {
    setupServiceMock(makeClientMock())
    const { useNotificationStore: useStore } = await import('./notification')
    const store = useStore()

    const result = store.parsePayload('{not valid json')
    expect(result.title).toBe('通知')
    expect(result.body).toBe('')
    expect(result.blockSnippet).toBe('')
    expect(result.eventDisplay).toBe('')
    expect(result.blockId).toBe('')
    expect(result.pageId).toBe('')
    expect(result.pageTitle).toBe('')
  })

  it('空字符串也触发兜底分支', async () => {
    setupServiceMock(makeClientMock())
    const { useNotificationStore: useStore } = await import('./notification')
    const store = useStore()

    const result = store.parsePayload('')
    expect(result.title).toBe('通知')
  })
})

// ============================================================
// markAsRead / markAllRead / snooze / deleteNotification
// Commit: 8069a35 - 通知系统重构
// ============================================================
describe('通知状态变更操作', () => {
  it('markAsRead 调用 service 并更新本地状态 + 刷新未读数', async () => {
    const clientMock = makeClientMock()
    clientMock.getUnreadCount.mockResolvedValue(0)
    setupServiceMock(clientMock)
    const { useNotificationStore: useStore } = await import('./notification')
    const store = useStore()

    const notif = makeNotification({ id: 'mark-read-1', status: 'unread' })
    store.notifications = [notif]

    await store.markAsRead('mark-read-1')

    expect(clientMock.updateNotificationStatus).toHaveBeenCalledWith('mark-read-1', 'read')
    // 本地应已更新为 read
    const updated = store.notifications.find(n => n.id === 'mark-read-1')
    expect(updated?.status).toBe('read')
    expect(clientMock.getUnreadCount).toHaveBeenCalled()
  })

  it('markAsRead 目标不在 notifications 数组时不报错，仅刷新未读数', async () => {
    const clientMock = makeClientMock()
    clientMock.updateNotificationStatus.mockResolvedValue(
      makeNotification({ id: 'ghost', status: 'read' })
    )
    setupServiceMock(clientMock)
    const { useNotificationStore: useStore } = await import('./notification')
    const store = useStore()

    await expect(store.markAsRead('ghost')).resolves.not.toThrow()
    expect(clientMock.getUnreadCount).toHaveBeenCalled()
  })

  it('markAllRead 将本地所有 unread 提升为 read 并调用 service', async () => {
    const clientMock = makeClientMock()
    setupServiceMock(clientMock)
    const { useNotificationStore: useStore } = await import('./notification')
    const store = useStore()

    store.notifications = [
      makeNotification({ id: 'a', status: 'unread' }),
      makeNotification({ id: 'b', status: 'read' }),
      makeNotification({ id: 'c', status: 'unread' }),
    ]

    await store.markAllRead()

    expect(clientMock.markAllNotificationsRead).toHaveBeenCalledTimes(1)
    // 本地所有 unread → read
    for (const n of store.notifications) {
      expect(n.status).not.toBe('unread')
    }
    expect(clientMock.getUnreadCount).toHaveBeenCalled()
  })

  it('snooze 调用 service 并更新本地记录', async () => {
    const clientMock = makeClientMock()
    setupServiceMock(clientMock)
    const { useNotificationStore: useStore } = await import('./notification')
    const store = useStore()

    const notif = makeNotification({ id: 'snooze-1', status: 'unread' })
    store.notifications = [notif]

    await store.snooze('snooze-1', 15)

    // setNotificationSnooze 被调用，snooze_until 非 null（由 mock 返回）
    expect(clientMock.setNotificationSnooze).toHaveBeenCalledTimes(1)
    const updated = store.notifications.find(n => n.id === 'snooze-1')
    expect(updated?.snooze_until).not.toBeNull()
    expect(updated?.status).toBe('pending')
    expect(clientMock.getUnreadCount).toHaveBeenCalled()
  })

  it('deleteNotification 实际为 dismiss（软删除），不调用物理 delete', async () => {
    const clientMock = makeClientMock()
    // queryRecentNotifications 返回空，模拟 reload 后无数据
    clientMock.queryRecentNotifications.mockResolvedValue([])
    setupServiceMock(clientMock)
    const { useNotificationStore: useStore } = await import('./notification')
    const store = useStore()

    const notif = makeNotification({ id: 'del-1', status: 'unread' })
    store.notifications = [notif]

    await store.deleteNotification('del-1')

    // 调用了 updateNotificationStatus('dismissed') —— 软删除锚点
    expect(clientMock.updateNotificationStatus).toHaveBeenCalledWith('del-1', 'dismissed')
    // 调用了 loadNotifications 刷新（queryRecentNotifications）
    expect(clientMock.queryRecentNotifications).toHaveBeenCalled()
  })
})

// ============================================================
// toggleSetting / updateSetting - 设置变更
// ============================================================
describe('设置变更操作', () => {
  it('toggleSetting 对布尔型设置取反并调用 save', async () => {
    const clientMock = makeClientMock()
    setupServiceMock(clientMock)
    const { useNotificationStore: useStore } = await import('./notification')
    const store = useStore()

    expect(store.settings.enabled).toBe(true)
    await store.toggleSetting('enabled')

    expect(store.settings.enabled).toBe(false)
    expect(clientMock.setNotificationSettings).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: false })
    )
  })

  it('updateSetting 直接写入值并调用 save', async () => {
    const clientMock = makeClientMock()
    setupServiceMock(clientMock)
    const { useNotificationStore: useStore } = await import('./notification')
    const store = useStore()

    await store.updateSetting('quiet_hours_start', '23:00')

    expect(store.settings.quiet_hours_start).toBe('23:00')
    expect(clientMock.setNotificationSettings).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ quiet_hours_start: '23:00' })
    )
  })
})

// ============================================================
// loadSettings / saveSettings / loadNotifications
// ============================================================
describe('加载与保存', () => {
  it('loadSettings 通过 client 获取设置并更新本地', async () => {
    const clientMock = makeClientMock()
    clientMock.getNotificationSettings.mockResolvedValue({
      ...DEFAULT_NOTIFICATION_SETTINGS,
      enabled: false,
      quiet_hours_start: '21:00',
    })
    setupServiceMock(clientMock)
    const { useNotificationStore: useStore } = await import('./notification')
    const store = useStore()

    expect(store.settings.enabled).toBe(true) // 默认
    await store.loadSettings()

    expect(store.settings.enabled).toBe(false)
    expect(store.settings.quiet_hours_start).toBe('21:00')
  })

  it('saveSettings 先本地更新再调用后端保存', async () => {
    const clientMock = makeClientMock()
    setupServiceMock(clientMock)
    const { useNotificationStore: useStore } = await import('./notification')
    const store = useStore()

    const newSettings = { ...DEFAULT_NOTIFICATION_SETTINGS, default_lead_minutes: 30 }
    await store.saveSettings(newSettings)

    expect(store.settings.default_lead_minutes).toBe(30)
    expect(clientMock.setNotificationSettings).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ default_lead_minutes: 30 })
    )
  })

  it('loadNotifications 设置 isLoading 标志', async () => {
    const clientMock = makeClientMock()
    const notifs = [makeNotification({ id: 'load-1' })]
    clientMock.queryRecentNotifications.mockResolvedValue(notifs)
    clientMock.getUnreadCount.mockResolvedValue(1)
    setupServiceMock(clientMock)
    const { useNotificationStore: useStore } = await import('./notification')
    const store = useStore()

    // 使用包装来捕获过程中的 isLoading 状态
    let loadingDuringCall: boolean | undefined
    const origGetter = Object.getOwnPropertyDescriptor(store, 'isLoading')
    // 由于 isLoading 是 ref，直接检查前后状态
    expect(store.isLoading).toBe(false)
    const loadPromise = store.loadNotifications()
    // 微任务队列内 isLoading 应为 true
    loadingDuringCall = store.isLoading
    await loadPromise

    // 最终状态
    expect(loadingDuringCall).toBe(true)
    expect(store.isLoading).toBe(false)
    expect(store.notifications.length).toBe(1)
    expect(store.unreadCount).toBe(1)
  })
})

// ============================================================
// triggerCheckAndFire - 触发检查与投递
// Commit: 8069a35 - 通知系统重构 (新增去重锚点 + 软删除)
// ============================================================
describe('triggerCheckAndFire - 通知触发', () => {
  it('新触发的通知插入到 notifications 头部并刷新计数', async () => {
    const clientMock = makeClientMock()
    const firedNotif = makeNotification({ id: 'fired-1', status: 'unread' })
    clientMock.checkAndFire.mockResolvedValue([firedNotif])
    setupServiceMock(clientMock)
    const { useNotificationStore: useStore } = await import('./notification')
    const store = useStore()

    // 预置一个老通知
    const oldNotif = makeNotification({ id: 'old-1', status: 'read' })
    store.notifications = [oldNotif]

    await store.triggerCheckAndFire()

    // 新通知在头部（unshift）
    expect(store.notifications[0].id).toBe('fired-1')
    expect(store.notifications[1].id).toBe('old-1')
    expect(clientMock.checkAndFire).toHaveBeenCalledTimes(1)
    expect(clientMock.getUnreadCount).toHaveBeenCalled()
  })

  it('已存在的通知被更新而非重复插入', async () => {
    const clientMock = makeClientMock()
    const firedUpdated = makeNotification({ id: 'dup-1', status: 'unread', fired_at: 9999 })
    clientMock.checkAndFire.mockResolvedValue([firedUpdated])
    setupServiceMock(clientMock)
    const { useNotificationStore: useStore } = await import('./notification')
    const store = useStore()

    const existing = makeNotification({ id: 'dup-1', status: 'pending', fired_at: 1000 })
    store.notifications = [existing]

    await store.triggerCheckAndFire()

    // 长度仍为 1，内容被更新
    expect(store.notifications.length).toBe(1)
    expect(store.notifications[0].fired_at).toBe(9999)
    expect(store.notifications[0].status).toBe('unread')
  })

  it('无新通知触发时仍然刷新计数与列表', async () => {
    const clientMock = makeClientMock()
    clientMock.checkAndFire.mockResolvedValue([])
    setupServiceMock(clientMock)
    const { useNotificationStore: useStore } = await import('./notification')
    const store = useStore()

    await store.triggerCheckAndFire()

    expect(clientMock.checkAndFire).toHaveBeenCalledTimes(1)
    expect(clientMock.getUnreadCount).toHaveBeenCalled()
    expect(clientMock.queryRecentNotifications).toHaveBeenCalled()
  })
})
