import { ref, onUnmounted } from 'vue'
import {
  isAndroidPlatform,
  tauriGetSyncStatus,
  tauriGetSyncStatusPC,
} from '../wasm/tauri-client'
import type { SyncStatus } from '../wasm/tauri-client'
import { getPairedDevices } from '../wasm/client'

// 模块级单例：整个应用共享一份轮询状态
const status = ref<SyncStatus | null>(null)
const pairedDevices = ref<{ client_id: string; peer_device_name: string; last_sync_at: number; paired_at: number | null }[]>([])
const isAndroid = ref(false)
const polling = ref(false)
let pollTimer: ReturnType<typeof setInterval> | null = null
let initialized = false

const POLL_INTERVAL_MS = 3000

async function refresh() {
  try {
    const s = isAndroid.value
      ? await tauriGetSyncStatus()
      : await tauriGetSyncStatusPC()
    status.value = s
  } catch {
    // 非 Tauri 环境或命令不存在时静默忽略
  }
}

async function refreshPairedDevices() {
  try {
    pairedDevices.value = await getPairedDevices()
  } catch {
    // 非 Tauri 环境静默忽略
  }
}

async function ensureStarted() {
  if (initialized) return
  initialized = true
  try {
    isAndroid.value = await isAndroidPlatform()
  } catch {
    isAndroid.value = false
  }
  await Promise.all([refresh(), refreshPairedDevices()])
  pollTimer = setInterval(async () => {
    await refresh()
    // 配对设备列表低频刷新（每 3 轮刷新一次）
    pollCount++
    if (pollCount % 3 === 0) await refreshPairedDevices()
  }, POLL_INTERVAL_MS)
  polling.value = true
}

let pollCount = 0

export function useSyncStatus() {
  ensureStarted()

  onUnmounted(() => {
    // 保持模块级轮询存活（侧边栏常驻），不在此停止
  })

  /** 触发一次即时刷新（如取消配对后） */
  function refreshNow() {
    return Promise.all([refresh(), refreshPairedDevices()])
  }

  return { status, pairedDevices, isAndroid, polling, refreshNow }
}
