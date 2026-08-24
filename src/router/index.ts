import { createRouter, createWebHistory } from 'vue-router'
import routes from './routes'
import { useBlockStore } from '../stores/blocks'
import { usePageStore } from '../stores/pages'
import { getCoreClient } from '../wasm/client'

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.afterEach(() => {})

router.beforeEach(async (to, from) => {
  // 离开点滴列表去普通页面时 abort 历史批量 IPC，避免占用 Mutex
  // ideas-list ↔ ideas-page 不 abort，让后台 IPC 完成以填充缓存
  // 注：stores 走顶部静态 import（它们已被 App.vue 静态引入、就在 bundle 里），
  // 不做动态 import——否则刷新后立即导航时，动态 import 会被 dev server 初次
  // 喂模块的 backlog 排队，实测在守卫里干等 ~2.8s 拖慢整个导航。
  if (
    from.name === 'ideas-list'
    && to.name !== 'ideas-list'
    && to.name !== 'ideas-page'
  ) {
    useBlockStore().abortMultiPageLoad()
  }

  // ideas-list 和 trash 路由由组件自身 onMounted 处理页面加载
  if (to.name === 'ideas-list' || to.name === 'trash') {
    return
  }

  const pageStore = usePageStore()

  if (to.name === 'page') {
    try {
      const rawParam = to.params.pageId as string

      // 刷新时内存缓存可能尚未加载，先确保已加载，避免 getPage/getPageByTitle
      // 双 miss 而误建垃圾 Page（与 Rust 端 create 幂等互为兜底）
      await pageStore.ensurePagesLoaded()

      let page = pageStore.getPage(rawParam) ?? pageStore.getPageByTitle(rawParam)

      if (!page) {
        page = await pageStore.createPage(rawParam, 'normal')
      }

      if (page && page.type === 'ideas') {
        return { name: 'ideas-page', params: { date: page.title } }
      }

      // 规范化 URL 为 UUID，避免 resolvedPageId computed 在页面重命名后
      // 因旧标题查询失败而回退为非 UUID 值
      if (page.id !== rawParam) {
        return { name: 'page', params: { pageId: page.id }, replace: true }
      }

      pageStore.setCurrentPage(page.id)
    } catch (error) {
      console.error('[beforeEach /page] Failed to load page:', error)
      return { name: 'ideas-list' }
    }
  }

  if (to.name === 'ideas-page') {
    try {
      // 解析命令走 CoreClient（getCoreClient 静态 import，避免守卫内动态 import 被 backlog 排队）
      const rawParam = to.params.date as string
      const normalized = await getCoreClient()!.normalizeJournalTitle(rawParam)

      if (!normalized) {
        return { name: 'page', params: { pageId: rawParam } }
      }

      let page = pageStore.getPageByTitle(normalized)

      if (!page) {
        if (await getCoreClient()!.isTodayTitle(normalized)) {
          // 今日页面：调用 Rust 端 ensureTodayIdeasPage 幂等获取或创建
          // （单一事实来源：避免 TS 端缓存 stale 导致的状态不一致）
          page = await pageStore.ensureTodayIdeasPage()
        } else {
          // 非今日历史页面：redirect 到 ideas-list，不自动创建
          return { name: 'ideas-list' }
        }
      }

      if (page && page.type !== 'ideas') {
        return { name: 'page', params: { pageId: normalized } }
      }

      pageStore.setCurrentPage(page.id)
    } catch (error) {
      console.error('[beforeEach /ideas] Failed to load page:', error)
      return { name: 'ideas-list' }
    }
  }
})

export default router
