import { createRouter, createWebHistory } from 'vue-router'
import routes from './routes'

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// 全局前置守卫：确保 Page 数据已加载
router.beforeEach(async () => {
  const { usePageStore } = await import('../stores/pages')
  const pageStore = usePageStore()
  // 若 Pinia 运行态为空，从 IndexedDB 持久化层补充 Page 数据
  if (pageStore.pages.length === 0) {
    await pageStore.loadAllPages()
  }
})

export default router
