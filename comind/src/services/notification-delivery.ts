import type { NotificationPayload } from '../types/notification'
import { isTauriEnvironment } from '../wasm/tauri-client'

export interface NotificationDelivery {
  notify(payload: NotificationPayload): Promise<void>
  requestPermission?(): Promise<boolean>
  hasPermission(): boolean
}

class TauriNotificationDelivery implements NotificationDelivery {
  async notify(payload: NotificationPayload): Promise<void> {
    if (!isTauriEnvironment()) {
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const app = (window as any).__TAURI__?.app
    if (app) {
      await app.emit('notification', payload)
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plugin = (window as any).__TAURI_PLUGIN_NOTIFICATION__
      if (plugin && plugin.notify) {
        await plugin.notify({
          title: payload.title,
          body: payload.body,
        })
      }
    } catch {
    }
  }

  hasPermission(): boolean {
    return true
  }
}

class WebNotificationDelivery implements NotificationDelivery {
  async notify(payload: NotificationPayload): Promise<void> {
    if (!('Notification' in window)) {
      return
    }

    if (Notification.permission !== 'granted') {
      return
    }

    new Notification(payload.title, {
      body: payload.body,
      tag: payload.blockId,
      data: {
        pageId: payload.pageId,
        blockId: payload.blockId,
      },
    })
  }

  async requestPermission(): Promise<boolean> {
    if (!('Notification' in window)) {
      return false
    }

    const permission = await Notification.requestPermission()
    return permission === 'granted'
  }

  hasPermission(): boolean {
    return 'Notification' in window && Notification.permission === 'granted'
  }
}

let deliveryInstance: NotificationDelivery | null = null

export function getNotificationDelivery(): NotificationDelivery {
  if (deliveryInstance) {
    return deliveryInstance
  }

  if (isTauriEnvironment()) {
    deliveryInstance = new TauriNotificationDelivery()
  } else {
    deliveryInstance = new WebNotificationDelivery()
  }

  return deliveryInstance
}