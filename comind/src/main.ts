import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import './styles/main.scss'
import App from './App.vue'
import { initCore } from './core'

// 先初始化 Core 层，再启动 Vue App
async function bootstrap() {
  try {
    await initCore('indexeddb')
  } catch (err) {
    console.error('[main] Failed to initialize Core layer:', err)
  }

  const app = createApp(App)
  app.use(createPinia())
  app.use(router)
  app.mount('#app')
}

bootstrap()
