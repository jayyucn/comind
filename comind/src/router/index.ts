import { createRouter, createWebHistory } from 'vue-router'
import routes from './routes'

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(async (to) => {
  // 跳过静态页面
  if (to.name === 'journal-list' || to.name === 'trash') {
    return
  }

  const { usePageStore } = await import('../stores/pages')
  const pageStore = usePageStore()

  // 确保页表已加载
  await pageStore.loadAllPages()

  // 处理 /page/:pageId 路由
  if (to.name === 'page') {
    try {
      const { getCore } = await import('../core')
      const core = getCore()
      const rawParam = to.params.pageId as string

      let page = pageStore.getPage(rawParam) ?? pageStore.getPageByTitle(rawParam)

      if (!page) {
        page = await core.pageService.getById(rawParam) ?? await core.pageService.getByTitle(rawParam)
        if (page) {
          if (!pageStore.pages.find(p => p.id === page!.id)) {
            pageStore.pages.push(page)
          }
        }
      }

      if (page && page.type === 'journal') {
        return { name: 'journal-page', params: { date: page.title } }
      }

      if (!page) {
        page = await pageStore.createPage(rawParam, 'normal')
      }

      await pageStore.openPage(page.id)
    } catch (error) {
      console.error('[beforeEach /page] Failed to load page:', error)
      return { name: 'journal-list' }
    }
  }

  // 处理 /journal/:date 路由
  if (to.name === 'journal-page') {
    try {
      const { getCore } = await import('../core')
      const core = getCore()
      const { normalizeJournalTitle } = await import('../utils/journal-detect')

      const rawParam = to.params.date as string
      const normalized = normalizeJournalTitle(rawParam)

      if (!normalized) {
        return { name: 'page', params: { pageId: rawParam } }
      }

      let page = pageStore.getPageByTitle(normalized)

      if (!page) {
        page = await core.pageService.getByTitle(normalized)
        if (page) {
          if (!pageStore.pages.find(p => p.id === page!.id)) {
            pageStore.pages.push(page)
          }
        }
      }

      if (page && page.type !== 'journal') {
        return { name: 'page', params: { pageId: normalized } }
      }

      if (!page) {
        page = await pageStore.createPage(normalized, 'journal')
      }

      await pageStore.openPage(page.id)
    } catch (error) {
      console.error('[beforeEach /journal] Failed to load page:', error)
      return { name: 'journal-list' }
    }
  }
})

export default router