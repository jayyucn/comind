import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NotificationPayload } from '../types/notification'

/**
 * 用 doMock 动态切换 isTauriEnvironment 的返回值。
 * 每组测试用 resetModules 拿到全新的 deliveryInstance 单例，
 * 避免上一个测试残留的状态。
 */

const isTauriMock = vi.hoisted(() => vi.fn<() => boolean>(() => false))

vi.mock('../wasm/tauri-client', () => ({
  isTauriEnvironment: isTauriMock,
}))

const payload: NotificationPayload = {
  title: '日程提醒',
  body: '团队周会',
  blockSnippet: '团队周会',
  eventDisplay: '2026-07-20T14:00',
  blockId: 'block-1',
  pageId: 'page-1',
  pageTitle: '工作台',
}

/** 用 Notification stub 模拟浏览器 Notification API */
function installNotificationApi(permission: 'default' | 'granted' | 'denied') {
  const Ctor = vi.fn()
  // @ts-expect-error 注入到 window
  window.Notification = Ctor
  // @ts-expect-error
  window.Notification.permission = permission
  // @ts-expect-error
  window.Notification.requestPermission = vi.fn(async () => permission)
  return Ctor
}

describe('WebNotificationDelivery', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    isTauriMock.mockReset()
    isTauriMock.mockReturnValue(false)
    // 清理 Notification stub
    // @ts-expect-error
    delete (window as any).Notification
    // @ts-expect-error
    delete (window as any).__TAURI__
    // @ts-expect-error
    delete (window as any).__TAURI_PLUGIN_NOTIFICATION__
  })

  it('window 上没有 Notification 时 notify 是 no-op', async () => {
    isTauriMock.mockReturnValue(false)
    const { getNotificationDelivery } = await import('./notification-delivery')
    const delivery = getNotificationDelivery()
    await expect(delivery.notify(payload)).resolves.toBeUndefined()
    expect(delivery.hasPermission()).toBe(false)
  })

  it('Notification.permission !== "granted" 时不弹窗', async () => {
    isTauriMock.mockReturnValue(false)
    const Ctor = installNotificationApi('default')
    const { getNotificationDelivery } = await import('./notification-delivery')
    const delivery = getNotificationDelivery()
    await delivery.notify(payload)
    expect(Ctor).not.toHaveBeenCalled()
  })

  it('Notification.permission === "granted" 时按 payload 创建 Notification，tag/data 正确', async () => {
    isTauriMock.mockReturnValue(false)
    const Ctor = installNotificationApi('granted')
    const { getNotificationDelivery } = await import('./notification-delivery')
    const delivery = getNotificationDelivery()
    await delivery.notify(payload)
    expect(Ctor).toHaveBeenCalledTimes(1)
    const [title, opts] = Ctor.mock.calls[0]
    expect(title).toBe(payload.title)
    expect(opts).toMatchObject({
      body: payload.body,
      tag: payload.blockId,
      data: { pageId: payload.pageId, blockId: payload.blockId },
    })
  })

  it('hasPermission 在 granted 时返回 true', async () => {
    isTauriMock.mockReturnValue(false)
    installNotificationApi('granted')
    const { getNotificationDelivery } = await import('./notification-delivery')
    expect(getNotificationDelivery().hasPermission()).toBe(true)
  })

  it('hasPermission 在 denied/default 时返回 false', async () => {
    isTauriMock.mockReturnValue(false)
    installNotificationApi('denied')
    const { getNotificationDelivery } = await import('./notification-delivery')
    expect(getNotificationDelivery().hasPermission()).toBe(false)
  })

  it('requestPermission 走 Notification.requestPermission 并在 granted 时返回 true', async () => {
    isTauriMock.mockReturnValue(false)
    const Ctor = installNotificationApi('default')
    // 让 requestPermission 走 granted
    Ctor.requestPermission = vi.fn(async () => 'granted')
    const { getNotificationDelivery } = await import('./notification-delivery')
    const delivery = getNotificationDelivery() as Required<ReturnType<typeof getNotificationDelivery>> & {
      requestPermission: () => Promise<boolean>
    }
    const ok = await delivery.requestPermission()
    expect(ok).toBe(true)
  })

  it('requestPermission 在无 Notification API 时返回 false', async () => {
    isTauriMock.mockReturnValue(false)
    // @ts-expect-error 显式删除
    delete (window as any).Notification
    const { getNotificationDelivery } = await import('./notification-delivery')
    const delivery = getNotificationDelivery() as { requestPermission: () => Promise<boolean> }
    const ok = await delivery.requestPermission()
    expect(ok).toBe(false)
  })
})

describe('TauriNotificationDelivery', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    isTauriMock.mockReset()
    // @ts-expect-error
    delete (window as any).Notification
    // @ts-expect-error
    delete (window as any).__TAURI__
    // @ts-expect-error
    delete (window as any).__TAURI_PLUGIN_NOTIFICATION__
  })

  it('isTauriEnvironment() === false 时整体 no-op', async () => {
    isTauriMock.mockReturnValue(false)
    const { getNotificationDelivery } = await import('./notification-delivery')
    // 非 Tauri 环境走 Web 路径；这里我们刻意覆盖为 false，但 TauriNotificationDelivery 自己内部也防一手
    // 该用例主要验证单例选择正确。
    const delivery = getNotificationDelivery()
    expect(delivery.hasPermission()).toBe(false)
  })

  it('isTauriEnvironment() === true 且 __TAURI__.app.emit 存在时调用 emit', async () => {
    isTauriMock.mockReturnValue(true)
    const emit = vi.fn(async () => undefined)
    // @ts-expect-error
    window.__TAURI__ = { app: { emit } }
    // @ts-expect-error
    window.__TAURI_PLUGIN_NOTIFICATION__ = undefined
    const { getNotificationDelivery } = await import('./notification-delivery')
    const delivery = getNotificationDelivery()
    await delivery.notify(payload)
    expect(emit).toHaveBeenCalledWith('notification', payload)
  })

  it('plugin notify 存在时同时调用 plugin.notify，参数取 title/body', async () => {
    isTauriMock.mockReturnValue(true)
    const emit = vi.fn(async () => undefined)
    const pluginNotify = vi.fn(async () => undefined)
    // @ts-expect-error
    window.__TAURI__ = { app: { emit } }
    // @ts-expect-error
    window.__TAURI_PLUGIN_NOTIFICATION__ = { notify: pluginNotify }
    const { getNotificationDelivery } = await import('./notification-delivery')
    await getNotificationDelivery().notify(payload)
    expect(pluginNotify).toHaveBeenCalledWith({ title: payload.title, body: payload.body })
  })

  it('plugin.notify 抛错时被吞掉，不影响 app.emit 的结果', async () => {
    isTauriMock.mockReturnValue(true)
    const emit = vi.fn(async () => undefined)
    const pluginNotify = vi.fn(async () => {
      throw new Error('plugin broken')
    })
    // @ts-expect-error
    window.__TAURI__ = { app: { emit } }
    // @ts-expect-error
    window.__TAURI_PLUGIN_NOTIFICATION__ = { notify: pluginNotify }
    const { getNotificationDelivery } = await import('./notification-delivery')
    await expect(getNotificationDelivery().notify(payload)).resolves.toBeUndefined()
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('hasPermission 恒为 true（Tauri 端由插件负责权限）', async () => {
    isTauriMock.mockReturnValue(true)
    // @ts-expect-error
    window.__TAURI__ = { app: { emit: vi.fn() } }
    const { getNotificationDelivery } = await import('./notification-delivery')
    expect(getNotificationDelivery().hasPermission()).toBe(true)
  })
})

describe('getNotificationDelivery 单例', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    isTauriMock.mockReset()
    // @ts-expect-error
    delete (window as any).Notification
    // @ts-expect-error
    delete (window as any).__TAURI__
  })

  it('同一模块多次调用返回同一实例', async () => {
    isTauriMock.mockReturnValue(false)
    installNotificationApi('granted')
    const { getNotificationDelivery } = await import('./notification-delivery')
    const a = getNotificationDelivery()
    const b = getNotificationDelivery()
    expect(a).toBe(b)
  })

  it('resetModules 后单例重建，新实例与旧实例不同', async () => {
    isTauriMock.mockReturnValue(false)
    installNotificationApi('granted')
    const mod1 = await import('./notification-delivery')
    const first = mod1.getNotificationDelivery()
    vi.resetModules()
    const mod2 = await import('./notification-delivery')
    const second = mod2.getNotificationDelivery()
    expect(first).not.toBe(second)
  })
})
