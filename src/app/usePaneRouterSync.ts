import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { usePageStore } from '../stores/pages'
import { type PaneView,samePaneView, usePanesStore } from '../stores/panes'

/** router 只是活动 PaneTab 的地址镜像；历史与布局状态全部在 pane store。 */
export function usePaneRouterSync() {
  const router = useRouter()
  const route = useRoute()
  const panesStore = usePanesStore()
  const pageStore = usePageStore()

  function pathForView(view: PaneView): string {
    if (view.kind === 'page') {
      const page = pageStore.getPage(view.ref!)
      return page?.type === 'ideas'
        ? `/ideas/${encodeURIComponent(page.title)}`
        : `/page/${encodeURIComponent(view.ref!)}`
    }
    if (view.kind === 'ideas') return '/ideas'
    if (view.kind === 'tags') return view.ref ? `/tags/${encodeURIComponent(view.ref)}` : '/tags'
    return `/${view.kind}`
  }

  function viewFromRoute(): PaneView | null {
    if (route.name === 'page') {
      const pageId = route.params.pageId as string
      return pageId ? { kind: 'page', ref: pageId } : null
    }
    if (route.name === 'ideas-page') {
      const title = route.params.date as string
      if (!title) return null
      return { kind: 'page', ref: pageStore.getPageByTitle(title)?.id ?? title }
    }
    if (route.name === 'ideas-list') return { kind: 'ideas' }
    if (route.name === 'graph') return { kind: 'graph' }
    if (route.name === 'tasks') return { kind: 'tasks' }
    if (route.name === 'tags-library') return { kind: 'tags' }
    if (route.name === 'tag-aggregate') {
      const tagId = route.params.tagId as string
      return tagId ? { kind: 'tags', ref: tagId } : null
    }
    if (route.name === 'pages-library') return { kind: 'pages' }
    if (route.name === 'trash') return { kind: 'trash' }
    return null
  }

  watch(
    () => panesStore.currentPageId,
    pageId => {
      const next = pageId ?? ''
      if (next !== pageStore.currentPageId) pageStore.setCurrentPage(next)
    },
    { flush: 'sync', immediate: true },
  )

  watch(
    () => panesStore.activeView,
    view => {
      if (!view) return
      const target = pathForView(view)
      if (route.path !== target) void router.replace(target)
    },
    { deep: true },
  )

  watch(
    () => route.fullPath,
    () => {
      if (!panesStore.hydrated) return
      const view = viewFromRoute()
      if (!view || (panesStore.activeView && samePaneView(panesStore.activeView, view))) return
      panesStore.navigate(view)
    },
  )

  function restore(): void {
    const view = viewFromRoute()
    if (view) panesStore.restore(view)
  }

  pageStore.onRemovePageFromHistory?.(panesStore.removePageFromHistory)
  return { restore }
}
