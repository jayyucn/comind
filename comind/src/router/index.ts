import { createRouter, createWebHistory } from 'vue-router'
import routes from './routes'

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(async (to, from) => {
  // 跳过静态页面
  if (to.name === 'journal-list' || to.name === 'trash' || to.name === 'settings') {
    return
  }

  // 防止无限重定向：如果我们正在从 page 重定向到 journal 或反之，直接放行
  const isRedirectingBetweenPageAndJournal = 
    (from.name === 'page' && to.name === 'journal-page') ||
    (from.name === 'journal-page' && to.name === 'page')
  
  if (isRedirectingBetweenPageAndJournal) {
    return
  }

  const { usePageStore } = await import('../stores/pages')
  const pageStore = usePageStore()

  // 确保页表已加载
  await pageStore.loadAllPages()

  // 处理 /page/:pageId 路由
  if (to.name === 'page') {
    try {
      const { storage } = await import('../storage/indexedDB')
      const rawParam = to.params.pageId as string

      let page = pageStore.getPage(rawParam) ?? pageStore.getPageByTitle(rawParam)

      if (!page) {
        page = await storage.getById(rawParam) ?? await storage.getPage(rawParam)
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
      const { storage } = await import('../storage/indexedDB')
      const { normalizeJournalTitle } = await import('../utils/journal-detect')

      const rawParam = to.params.date as string
      const normalized = normalizeJournalTitle(rawParam)

      if (!normalized) {
        return { name: 'page', params: { pageId: rawParam } }
      }

      let page = pageStore.getPageByTitle(normalized)

      if (!page) {
        page = await storage.getPage(normalized)
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