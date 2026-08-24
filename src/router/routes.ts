import type { RouteRecordRaw } from 'vue-router'
import './types'
// 图谱页静态引入（非懒加载）：刷新后立刻点图谱时，若用懒 import() 拉取该 chunk
// （内含 G6 大依赖），请求会被 dev server 初次喂模块的 backlog 排队，导致路由解析
// （afterEach）干等 ~2.7s 才打开图谱界面。GraphPage 本身体积很小，静态引入对首屏
// 几乎无影响；真正重的 G6 仍在 GraphPage 内部按需加载（defineAsyncComponent），不进首屏。
import GraphPage from '../components/GraphView/GraphPage.vue'
// 页面库页同样静态引入：懒 chunk 在 dev 模式首次导航时会被 dev server 的模块
// backlog 排队（与 GraphPage 同一根因），实测从点滴首次切到页面库卡 ~2.7s。
// PagesLibrary 不含重依赖，静态引入对首屏无影响。
import PagesLibrary from '../components/PagesLibrary/PagesLibrary.vue'

/**
 * 路由配置
 *
 * RouteMeta 支持的配置项：
 * - fullWidth?: boolean — 页面是否撑满可用宽度（移除内容区域的 max-width 限制）
 *   使用场景：图谱、仪表盘、表格等需要大空间展示的页面
 * - hideRightSidebarToggle?: boolean — 是否隐藏右侧面板切换按钮
 *   使用场景：不需要右侧面板的页面
 *   示例：
 *     {
 *       path: '/graph',
 *       name: 'graph',
 *       component: GraphPage, // 静态引入，避免 dev 模式懒 chunk 被模块 backlog 排队拖慢导航
 *       meta: { fullWidth: true, hideRightSidebarToggle: true }
 *     }
 */
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/ideas',
  },
  {
    path: '/ideas',
    name: 'ideas-list',
    component: () => import('../components/Ideas/IdeasList.vue'),
    meta: { fullWidth: true, hideRightSidebarToggle: true },
  },
  {
    path: '/ideas/:date',
    name: 'ideas-page',
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
    meta: { fullWidth: true, hideRightSidebarToggle: true, absolute: true },
  },
  {
    path: '/graph',
    name: 'graph',
    component: GraphPage,
    meta: { fullWidth: true, hideRightSidebarToggle: true },
  },
  {
    path: '/pages',
    name: 'pages-library',
    component: PagesLibrary,
    meta: { fullWidth: true, hideRightSidebarToggle: true},
  },
  {
    path: '/tasks',
    name: 'tasks',
    component: () => import('../components/TaskHub/TaskHub.vue'),
    meta: { fullWidth: true, hideRightSidebarToggle: true },
  },
  // 404 兜底
  {
    path: '/:pathMatch(.*)*',
    redirect: '/ideas',
  },
]

export default routes
