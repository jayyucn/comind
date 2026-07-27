import { ref, onUnmounted } from 'vue'
import {
  isAndroidPlatform,
  tauriGetSyncStatus,
  tauriGetSyncStatusPC,
} from '../wasm/tauri-client'
import type { SyncStatus } from '../wasm/tauri-client'

// 模块级单例：整个应用共享一份轮询状态
const status = ref<SyncStatus | null>(null)
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

async function ensureStarted() {
  if (initialized) return
  initialized = true
  try {
    isAndroid.value = await isAndroidPlatform()
  } catch {
    isAndroid.value = false
  }
  await refresh()
  pollTimer = setInterval(refresh, POLL_INTERVAL_MS)
  polling.value = true
}

export function useSyncStatus() {
  ensureStarted()

  onUnmounted(() => {
    // 保持模块级轮询存活（侧边栏常驻），不在此停止
  })

  /** 触发一次即时刷新（如取消配对后） */
  function refreshNow() {
    return refresh()
  }

  return { status, isAndroid, polling, refreshNow }
}
