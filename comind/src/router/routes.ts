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
    component: () => import('../components/Page/index.vue'),
    props: (route) => ({ pageId: route.params.date as string }),
  },
  {
    path: '/page/:pageId',
    name: 'page',
    component: () => import('../components/Page/index.vue'),
    props: (route) => ({ pageId: route.params.pageId as string }),
  },
  {
    path: '/trash',
    name: 'trash',
    component: () => import('../components/Trash/TrashList.vue'),
  },
  // 404 兜底
  {
    path: '/:pathMatch(.*)*',
    redirect: '/journal',
  },
]

export default routes