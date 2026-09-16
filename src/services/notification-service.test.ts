import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NotificationService, getNotificationService, loadNotificationSettings } from './notification-service'
import { DEFAULT_NOTIFICATION_SETTINGS } from '../types/notification'
import type { CoreClient } from '../wasm/client'
import type { Notification } from '../wasm/types'

// 业务逻辑（周期计算、静默时段、去重锚点、buildPayload）已迁移到
// comind-core NotificationService（Rust，见 crates/comind-core/src/services/
// notification_service.rs 的 #[cfg(test)]）。TS 侧只剩薄委托 + 设置读写，
// 本文件验证这一委托契约。

function makeClient(): CoreClient {
  return {
    queryUnreadNotifications: vi.fn(async () => [{ id: 'n1' } as Notification]),
    queryRecentNotifications: vi.fn(async () => [{ id: 'n2' } as Notification]),
    getNotificationsByBlock: vi.fn(async () => [{ id: 'n3' } as Notification]),
    getNotification: vi.fn(async () => ({ id: 'n4' } as Notification)),
    updateNotificationStatus: vi.fn(async (id: string, status: string) => ({ id, status } as Notification)),
    markAllNotificationsRead: vi.fn(async () => {}),
    setNotificationSnooze: vi.fn(async (id: string, _snoozeUntil: number, status: string) => ({ id, status } as Notification)),
    deleteNotification: vi.fn(async () => {}),
    cleanupNotifications: vi.fn(async () => {}),
    updateNotificationPayload: vi.fn(async (id: string, payload: string) => ({ id, payload } as Notification)),
    checkAndFire: vi.fn(async () => [{ id: 'fired_1' } as Notification]),
    syncPayloadForBlock: vi.fn(async () => {}),
    getNotificationSettings: vi.fn(async () => ({ ...DEFAULT_NOTIFICATION_SETTINGS, enabled: false })),
    saveNotificationSettings: vi.fn(async () => {}),
  } as unknown as CoreClient
}

describe('NotificationService（薄委托契约）', () => {
  let client: CoreClient
  let svc: NotificationService

  beforeEach(() => {
    client = makeClient()
    svc = new NotificationService(client)
  })

  it('checkAndFire 委托 client.checkAndFire（settings 由 Rust 端裁决）', async () => {
    const fired = await svc.checkAndFire({ ...DEFAULT_NOTIFICATION_SETTINGS, enabled: false })
    expect(client.checkAndFire).toHaveBeenCalledTimes(1)
    expect(fired).toEqual([{ id: 'fired_1' }])
  })

  it('checkAndFire 缺省 settings 时同样委托', async () => {
    await svc.checkAndFire()
    expect(client.checkAndFire).toHaveBeenCalledTimes(1)
  })

  it('syncPayloadForBlock 委托 client.syncPayloadForBlock', async () => {
    await svc.syncPayloadForBlock('block_1')
    expect(client.syncPayloadForBlock).toHaveBeenCalledWith('block_1')
  })

  it('getUnreadCount 返回未读数量', async () => {
    expect(await svc.getUnreadCount()).toBe(1)
    expect(client.queryUnreadNotifications).toHaveBeenCalledTimes(1)
  })

  it('getRecentNotifications 带 limit 查询', async () => {
    await svc.getRecentNotifications(10)
    expect(client.queryRecentNotifications).toHaveBeenCalledWith(10)
  })

  it('markAsRead / dismiss 走 updateNotificationStatus 对应状态', async () => {
    const read = await svc.markAsRead('n1')
    expect(read.status).toBe('read')
    const dismissed = await svc.dismiss('n2')
    expect(dismissed.status).toBe('dismissed')
  })

  it('snooze 以 now + minutes 计算 snoozeUntil 并转 pending', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 20, 9, 0, 0, 0))
    try {
      await svc.snooze('n1', 30)
      expect(client.setNotificationSnooze).toHaveBeenCalledWith('n1', Date.now() + 30 * 60 * 1000, 'pending')
    } finally {
      vi.useRealTimers()
    }
  })

  it('cleanupOldNotifications 以 30 天保留期清理', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 20, 9, 0, 0, 0))
    try {
      await svc.cleanupOldNotifications()
      expect(client.cleanupNotifications).toHaveBeenCalledWith(Date.now() - 30 * 24 * 60 * 60 * 1000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('getNotificationService 返回共享单例', () => {
    const a = getNotificationService(client)
    const b = getNotificationService(client)
    expect(a).toBe(b)
  })

  it('loadNotificationSettings 成功路径返回存储值，失败回退默认值', async () => {
    const loaded = await loadNotificationSettings(client)
    expect(loaded.enabled).toBe(false)

    const broken = { getNotificationSettings: vi.fn(async () => { throw new Error('boom') }) } as unknown as CoreClient
    const fallback = await loadNotificationSettings(broken)
    expect(fallback).toEqual(DEFAULT_NOTIFICATION_SETTINGS)
  })
})
