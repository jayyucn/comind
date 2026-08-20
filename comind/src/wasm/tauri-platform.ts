// 平台能力模块（ADR-0020 Q3/Q6）：Tauri 特有的窗口控制、平台检测、目录选择与同步/连接。
// 与 CoreClient（业务数据命令面）分离：web 无同步概念，同步类不进 CoreClient，避免 wasm stub。
import { invoke, isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-dialog'
import { platform } from '@tauri-apps/plugin-os'
import type { Block, Page, Notification, DateRefRecord } from './types'

export interface TauriBatchCheckAndFireData {
  recurring_refs: DateRefRecord[]
  due_non_recurring: DateRefRecord[]
  blocks: Block[]
  pages: Page[]
  notifications: Notification[]
}

export interface TauriGraphEdgeRecord {
  link_id: string
  source_page_id: string
  source_page_title: string
  target_page_id: string
  target_page_title: string
  relationship_type: string | null
}

export interface SyncPeer {
  client_id: string
  name: string
  ip: string
}

export interface SyncStatus {
  connected: boolean
  paired: boolean
  /** PC 端：已连接对端列表；Android 端：对端信息（可能为空） */
  peers: SyncPeer[]
  /** Android 端：已连接的 PC 名称；PC 端为 null */
  server_name: string | null
}

export function isTauriEnvironment(): boolean {
  return isTauri()
}

/** 是否运行在 Android 端（同步初步检测，基于 UA） */
export function isAndroidPlatformSync(): boolean {
  if (!isTauri()) return false
  if (typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)) return true
  return false
}

/** 是否运行在 Android 端（基于 Tauri os 插件，可靠检测） */
export async function isAndroidPlatform(): Promise<boolean> {
  if (!isTauri()) return false
  try {
    return await platform() === 'android'
  } catch {
    return false
  }
}

// ---- 窗口控制 ----

export async function tauriMinimizeWindow(): Promise<void> {
  const window = getCurrentWindow()
  await window.minimize()
}

export async function tauriToggleMaximizeWindow(): Promise<void> {
  const window = getCurrentWindow()
  const isMaximized = await window.isMaximized()
  if (isMaximized) {
    await window.unmaximize()
  } else {
    await window.maximize()
  }
}

export async function tauriCloseWindow(): Promise<void> {
  const window = getCurrentWindow()
  await window.close()
}

export async function tauriIsMaximized(): Promise<boolean> {
  const window = getCurrentWindow()
  return window.isMaximized()
}

// ---- 目录选择 ----

export async function tauriPickDirectory(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: '选择工作空间目录',
  })
  if (typeof selected === 'string') {
    return selected
  }
  return null
}

// ---- 同步 / 连接（Tauri 特有；web 无同步对端） ----

/** Android 扫码后连接 PC 并配对 */
export async function tauriConnectToServer(qrPayload: string): Promise<void> {
  return invoke('connect_to_server', { qrPayload })
}

/** Android: 从 DB 恢复已配对设备连接（App 启动时调用） */
export async function tauriAutoReconnect(): Promise<boolean> {
  return invoke('auto_reconnect')
}

/** Android 断开同步连接 */
export async function tauriDisconnectSync(): Promise<void> {
  return invoke('disconnect_sync')
}

/** 获取当前同步状态（Android 端） */
export async function tauriGetSyncStatus(): Promise<SyncStatus> {
  return invoke('get_sync_status')
}

/** PC 端：获取同步状态（服务端内存态，含已连接对端） */
export async function tauriGetSyncStatusPC(): Promise<SyncStatus> {
  return invoke('get_sync_status')
}

/** Android 手动触发全量同步 */
export async function tauriTriggerFullSyncMobile(): Promise<void> {
  return invoke('trigger_full_sync_mobile')
}
