import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import './styles/main.scss'
import App from './App.vue'
import { initCoreClient, getCoreClient } from './wasm/client'

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
  app.mount('#app')
}

bootstrap()

;(window as any).__get_core_client = getCoreClient
