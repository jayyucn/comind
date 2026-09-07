import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import './styles/main.scss'
import App from './App.vue'
import { initCoreClient, getCoreClient } from './wasm/client'
import { initOverlayScrollbars } from './utils/overlayScrollbar'

async function bootstrap() {
  try {
    const client = await initCoreClient()
    // 迁移：DateRef 表为新建，历史 block 需全量回填一次（写入路径只维护变更）。
    // 用 localStorage 标记保证每个 profile 仅回填一次，避免每次启动全表重扫。
    const REBUILT_KEY = 'dateref_rebuilt_v1'
    if (!localStorage.getItem(REBUILT_KEY)) {
      try {
        const res = await client.rebuildDateRefs()
        console.info('[main] rebuilt date refs:', res.rebuilt)
        localStorage.setItem(REBUILT_KEY, '1')
      } catch (err) {
        console.warn('[main] rebuildDateRefs failed (non-fatal):', err)
      }
    }
  } catch (err) {
    console.error('[main] Failed to initialize Core client:', err)
  }

  const app = createApp(App)
  app.use(createPinia())
  app.use(router)
  // 全局浮层滚动条：隐藏原生滚动条，改为滚动/悬停时浮现的浮层指示条（Chromium）。
  initOverlayScrollbars()
  // Dev-only: 注册 tauri-plugin-mcp 的 webview 端监听器，供 AI Agent 在开发期
  // 驱动/检查当前 webview（所有 webview 共用此入口，覆盖 main 与 reader-*）。
  // 与 Rust 侧 cfg(debug_assertions) 注册对应；动态 import 让生产 bundle
  // 彻底剥离该模块（静态导入会被打进主 chunk）。
  if (import.meta.env.DEV) {
    const { setupPluginListeners } = await import('tauri-plugin-mcp')
    setupPluginListeners()
  }
  // 等待初始导航完成（router.beforeEach 守卫执行完毕）后再挂载，
  // 确保 App.vue onMounted 中的 checkAndEnsureTodayIdeas 不会与守卫并发执行，
  // 避免重复创建页面及 loadPageBlocks 覆盖内存中尚未持久化的 block。
  // await router.isReady()
  app.mount('#app')
}

bootstrap()

;(window as any).__get_core_client = getCoreClient
