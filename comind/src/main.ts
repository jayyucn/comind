import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import './styles/main.scss'
import App from './App.vue'
import { initCoreClient, getCoreClient } from './wasm/client'

async function bootstrap() {
  try {
    await initCoreClient()
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
