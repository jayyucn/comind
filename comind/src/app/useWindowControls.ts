import { ref, onMounted } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  isTauriEnvironment,
  isAndroidPlatformSync,
  tauriAutoReconnect,
  tauriCloseWindow,
  tauriIsMaximized,
  tauriMinimizeWindow,
  tauriToggleMaximizeWindow,
} from '../wasm/tauri-client'

/**
 * 窗口控制 + 连接生命周期（窗口按钮/拖拽/resize + Android 自动重连 + online 监听）。
 * 非 Tauri 环境各方法早退，避免浏览器下误触。
 */
export function useWindowControls() {
  const isMaximized = ref(false)

  async function startDragging(e: MouseEvent) {
    if (!isTauriEnvironment()) return
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('.top-right-controls')) return
    const window = getCurrentWindow()
    await window.startDragging()
  }

  async function minimize() {
    if (!isTauriEnvironment()) return
    await tauriMinimizeWindow()
  }

  async function maximize() {
    if (!isTauriEnvironment()) return
    await tauriToggleMaximizeWindow()
    isMaximized.value = await tauriIsMaximized()
  }

  async function close() {
    if (!isTauriEnvironment()) {
      window.close()
      return
    }
    await tauriCloseWindow()
  }

  async function updateMaximizedState() {
    if (isTauriEnvironment()) {
      isMaximized.value = await tauriIsMaximized()
    }
  }

  onMounted(async () => {
    await updateMaximizedState()

    if (isTauriEnvironment()) {
      const window = getCurrentWindow()
      window.listen('tauri://resize', async () => {
        isMaximized.value = await tauriIsMaximized()
      })

      // Android: 启动时自动重连已配对的 PC
      if (isAndroidPlatformSync()) {
        tauriAutoReconnect()
          .then((found) => {
            if (found) console.log('[auto-reconnect] Paired device found, connecting...')
            else console.log('[auto-reconnect] No paired device')
          })
          .catch((e) => {
            console.warn('[auto-reconnect] Failed:', e)
          })
      }

      // 网络恢复时触发重连（Android + 桌面端）
      globalThis.addEventListener('online', () => {
        console.log('[network] Online event fired')
        if (isAndroidPlatformSync()) {
          tauriAutoReconnect().catch((e) => {
            console.warn('[auto-reconnect] Online reconnect failed:', e)
          })
        }
      })
    }
  })

  return { isMaximized, startDragging, minimize, maximize, close }
}
