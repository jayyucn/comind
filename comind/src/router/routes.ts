import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/journal',
  },
  {
    path: '/journal',
    name: 'journal-list',
    component: () => import('../components/Journal/JournalList.vue'),
  },
  {
    path: '/journal/:date',
    name: 'journal-page',
    component: () => import('../views/PageView.vue'),
    beforeEnter: async (to) => {
      const { usePageStore } = await import('../stores/pages')
      const pageStore = usePageStore()
      await pageStore.loadAllPages()
      const page = pageStore.getPageByTitle(to.params.date as string)
      if (page) {
        await pageStore.openPage(page.id)
      }
    },
  },
  {
    path: '/page/:pageId',
    name: 'page',
    component: () => import('../views/PageView.vue'),
    beforeEnter: async (to) => {
      const { usePageStore } = await import('../stores/pages')
      const pageStore = usePageStore()
      await pageStore.loadAllPages()
      const page = pageStore.getPage(to.params.pageId as string)
      if (page) {
        await pageStore.openPage(page.id)
      }
    },
  },
  // 404 兜底
  {
    path: '/:pathMatch(.*)*',
    redirect: '/journal',
  },
]

export default routes
