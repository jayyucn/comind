import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { usePageStore } from '../stores/pages'
import { usePanesStore } from '../stores/panes'
import { createPaneHistory } from './paneHistory'

/**
 * pane 导航编排层（ADR-0059 D3/D4）：维护「activePaneId → URL → currentPageId」不变式
 * 与每 pane 独立导航栈。
 *
 * 单一数据流：
 * - 活动 pane 的页（activePanePageId）是「当前页」的唯一来源；
 * - `currentPageId` 退化为派生值：watch 活动 pane 页 → pageStore.setCurrentPage
 *   （flush: 'sync'，保证 selection.toggleBlock 在焦点跟随后能同步读到新值）；
 * - URL = 活动 pane 页：活动 pane / 其页变化 → router.replace（不 push，避免污染历史）；
 * - URL → pane：外部导航（侧栏/wiki-link/命令面板的 router.push）→ 活动 pane 跟随
 *   （setActivePage），只写活动 pane、不切 activePaneId；
 * - 每 pane 独立栈：逐 pane 跟踪页变化即记录（back/forward 内部抑制），
 *   后退/前进通过 navigatePane 直接改该 pane 页（浏览器原生历史完全解耦）。
 *
 * 双向 sync 都带「值已一致则 no-op」守卫，避免相互触发死循环。
 */
export function usePanesNavigation() {
  const router = useRouter()
  const route = useRoute()
  const panesStore = usePanesStore()
  const pageStore = usePageStore()

  const history = createPaneHistory()

  const activePanePageId = computed(() => {
    return panesStore.panes.find(p => p.id === panesStore.activePaneId)?.pageId ?? ''
  })

  /** 页 id → 路由路径（ideas 页走 /ideas/:title，其余走 /page/:id） */
  function routePathForPage(pageId: string): string {
    const page = pageStore.getPage(pageId)
    if (page?.type === 'ideas') {
      return `/ideas/${encodeURIComponent(page.title)}`
    }
    return `/page/${encodeURIComponent(pageId)}`
  }

  /** 当前路由解析出的页 id（非页面路由返回 ''） */
  function pageIdFromRoute(): string {
    if (route.name === 'page') return (route.params.pageId as string) || ''
    if (route.name === 'ideas-page') {
      const title = route.params.date as string
      if (!title) return ''
      return pageStore.getPageByTitle(title)?.id ?? title
    }
    return ''
  }

  // ── 派生：currentPageId = 活动 pane 页（flush sync，焦点跟随顺序收口）──
  watch(
    activePanePageId,
    (pageId) => {
      if (pageId && pageId !== pageStore.currentPageId) {
        pageStore.setCurrentPage(pageId)
      }
    },
    { flush: 'sync', immediate: true },
  )

  // ── 每 pane 导航栈：逐 pane 跟踪页变化并记录（back/forward 抑制）──
  // 不以 activePanePageId 为记录键：openInOtherPane「替换非活动 pane 并激活」时，
  // 若目标页恰为原活动 pane 的页，activePanePageId 前后不变 → 漏记（实测缺陷）；
  // 且按 pageId 反查 pane 在「双 pane 同页」时会记错栏。
  let suppressRecord = false
  const lastPanePages = new Map<string, string>()
  watch(
    () => panesStore.panes,
    (panes) => {
      const seen = new Set<string>()
      for (const p of panes) {
        seen.add(p.id)
        const prev = lastPanePages.get(p.id)
        if (prev === undefined) {
          // 新 pane：初始化跟踪并播种栈（首页不产生可后退项）
          lastPanePages.set(p.id, p.pageId)
          if (p.pageId) history.ensure(p.id, p.pageId)
          continue
        }
        if (p.pageId && p.pageId !== prev) {
          lastPanePages.set(p.id, p.pageId)
          if (!suppressRecord) history.record(p.id, p.pageId)
        }
      }
      for (const id of [...lastPanePages.keys()]) {
        if (!seen.has(id)) lastPanePages.delete(id)
      }
    },
    { flush: 'sync', deep: true },
  )

  // ── URL = 活动 pane 页（pane 驱动 URL，replace 不 push）──
  watch(
    [() => panesStore.activePaneId, activePanePageId],
    () => {
      const pageId = activePanePageId.value
      if (!pageId) return
      const target = routePathForPage(pageId)
      if (route.path !== target) {
        router.replace(target)
      }
    },
  )

  // ── URL → pane（外部导航驱动活动 pane）──
  watch(
    () => route.fullPath,
    () => {
      // 启动竞态护栏：router.isReady() 未被 await（main.ts 有意先挂载），
      // 初始路由解析完成早于 App onMounted 的 loadFromStorage。此时写 pane 会
      // 先 ensurePane 再被 persist 落盘，把存档的双 pane 布局覆盖成单 URL 页
      // （运行时实测缺陷 F4）。读档前不写 pane，启动 reconcile 由 restore() 负责。
      if (!panesStore.hydrated) return
      const pageId = pageIdFromRoute()
      if (!pageId) return
      if (pageId !== activePanePageId.value) {
        panesStore.setActivePage(pageId)
      }
    },
  )

  // ── pane 内后退/前进（作用于本 pane 栈，浏览器历史解耦）──
  function goBack(paneId: string): void {
    const pageId = history.back(paneId)
    if (!pageId) return
    suppressRecord = true
    panesStore.navigatePane(paneId, pageId)
    suppressRecord = false
  }

  function goForward(paneId: string): void {
    const pageId = history.forward(paneId)
    if (!pageId) return
    suppressRecord = true
    panesStore.navigatePane(paneId, pageId)
    suppressRecord = false
  }

  function canGoBack(paneId: string): boolean {
    return history.canGoBack(paneId)
  }

  /** 后退目标页（不移动索引）：供 pane 面包屑显示「上级」层级 */
  function previousPageId(paneId: string): string | null {
    return history.previous(paneId)
  }

  function canGoForward(paneId: string): boolean {
    return history.canGoForward(paneId)
  }

  /**
   * 启动 reconcile（D2）：路由 resolve 后，把 URL 页与已存布局对齐。
   * - 无 pane → 引导一个 pane 装 URL 页；
   * - URL 页已在布局中 → 激活持有它的 pane；
   * - URL 页不在布局中 → 用 URL 页覆盖第一个 pane 并激活它（spec D2「覆盖第一个 pane」）。
   * 非页面路由（当前无页）时 no-op，进入页面路由时由 URL→pane watcher 恢复。
   */
  function restore(): void {
    const routePageId = pageIdFromRoute()
    if (!routePageId) return
    if (panesStore.panes.length === 0) {
      panesStore.ensurePane(routePageId)
      return
    }
    const match = panesStore.panes.find(p => p.pageId === routePageId)
    if (match) {
      panesStore.activatePane(match.id)
    } else {
      panesStore.navigatePane(panesStore.panes[0].id, routePageId)
    }
  }

  // 页面删除时从所有 pane 栈剔除（注册回调，与旧 useNavigationHistory 同口径）
  pageStore.onRemovePageFromHistory?.(history.removePage)

  return { restore, goBack, goForward, canGoBack, canGoForward, previousPageId }
}
