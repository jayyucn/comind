import type { RouteRecordRaw } from 'vue-router'
import './types'

/**
 * 路由配置
 *
 * RouteMeta 支持的配置项：
 * - fullWidth?: boolean — 页面是否撑满可用宽度（移除内容区域的 max-width 限制）
 *   使用场景：图谱、仪表盘、表格等需要大空间展示的页面
 *   示例：
 *     {
 *       path: '/graph',
 *       name: 'graph',
 *       component: () => import('../components/GraphView/index.vue'),
 *       meta: { fullWidth: true }
 *     }
 */
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
  {
    path: '/graph',
    name: 'graph',
    component: () => import('../components/GraphView/index.vue'),
    meta: { fullWidth: true },
  },
  // 404 兜底
  {
    path: '/:pathMatch(.*)*',
    redirect: '/journal',
  },
]

export default routes