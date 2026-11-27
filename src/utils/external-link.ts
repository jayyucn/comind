import { invoke } from '@tauri-apps/api/core'

import { isTauriEnvironment } from '../wasm/tauri-platform'

/** 只放行 http(s)：`javascript:` / `file:` / `tauri:` 一律不进系统打开器。 */
const EXTERNAL_URL_RE = /^https?:\/\//i

/**
 * 抢回焦点的时间点（毫秒，相对 `openUrl` 返回后）——ADR-0069 D6。
 *
 * 系统浏览器启动时会把前台抢走，而且**抢两次**：窗口刚建出来时一次，页面加载完
 * 再激活一次；冷启动还会把第一次拖到 1s 以后（实测 example.com 在 0.1s 与 1.5s
 * 各抢一回）。所以铺到 3s、前密后疏，`focus_main_window` 幂等（已在前台直接返回），
 * 多调无副作用。
 */
const FOCUS_RECLAIM_DELAYS_MS = [0, 150, 400, 800, 1300, 2000, 3000]

function scheduleFocusReclaim(): void {
  for (const delay of FOCUS_RECLAIM_DELAYS_MS) {
    window.setTimeout(() => {
      void invoke('focus_main_window').catch(() => {
        // 抢不回焦点不影响链接已经打开，静默（与 D5 同一口径）
      })
    }, delay)
  }
}

/**
 * 打开外部链接的唯一入口（ADR-0069 D1）。
 *
 * 为什么不能直接 `window.open(url, '_blank')`：桌面端 WebView2 的
 * `NewWindowRequested` 在「宿主没挂 new_window_req_handler」时会被内核直接取消
 * （wry 0.55 `webview2/mod.rs`：无 handler 即 `args.SetHandled(true)`）。表现是
 * **点了完全没反应**，而浏览器里同一行代码正常开新标签页 —— e2e 因此永远测不出来。
 *
 * 桌面/移动端统一交给系统默认浏览器（tauri-plugin-opener：Windows ShellExecute、
 * Android Intent、iOS openURL）；非 Tauri 环境（vite dev / Playwright）保留
 * `window.open` 的原生语义，e2e 仍能断言 popup。
 *
 * 失败静默（只记控制台，ADR-0069 D5）：外链打不开是环境问题，弹提示比不打开更吵。
 *
 * 打开后把焦点抢回本应用（ADR-0069 D6）：浏览器一定会在前台冒出来，桌面端在
 * ~1s 内补几次 `focus_main_window`，做到「链接打开、comind 仍是前台」。
 *
 * @returns 是否成功发起打开；调用方通常不需要它（保持 fire-and-forget）
 */
export async function openExternalUrl(url: string | null | undefined): Promise<boolean> {
  if (!url) return false
  if (!EXTERNAL_URL_RE.test(url)) {
    console.error('[external-link] 拒绝打开非 http(s) 链接:', url)
    return false
  }

  if (isTauriEnvironment()) {
    try {
      // 动态 import：浏览器构建里不会走到，也避免 vite dev 首屏多拉一个 Tauri 包
      const { openUrl } = await import('@tauri-apps/plugin-opener')
      await openUrl(url)
      // 浏览器在前台抢走了焦点：立刻把主窗口抢回来，链接等于在后台打开（D6）
      scheduleFocusReclaim()
      return true
    } catch (err) {
      console.error('[external-link] 系统浏览器打开失败:', url, err)
      return false
    }
  }

  try {
    window.open(url, '_blank', 'noopener,noreferrer')
    return true
  } catch (err) {
    console.error('[external-link] 新标签页打开失败:', url, err)
    return false
  }
}
