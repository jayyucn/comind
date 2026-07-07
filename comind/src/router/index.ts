import { createRouter, createWebHistory } from 'vue-router'
import routes from './routes'

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(async (to) => {
  if (to.name === 'journal-list' || to.name === 'trash') {
    return
  }

  const { usePageStore } = await import('../stores/pages')
  const pageStore = usePageStore()

  await pageStore.loadAllPages()

  if (to.name === 'page') {
    try {
      const rawParam = to.params.pageId as string

      let page = pageStore.getPage(rawParam) ?? pageStore.getPageByTitle(rawParam)

      if (!page) {
        page = await pageStore.createPage(rawParam, 'normal')
      }

      if (page && page.type === 'journal') {
        return { name: 'journal-page', params: { date: page.title } }
      }

      // 规范化 URL 为 UUID，避免 resolvedPageId computed 在页面重命名后
      // 因旧标题查询失败而回退为非 UUID 值
      if (page.id !== rawParam) {
        return { name: 'page', params: { pageId: page.id }, replace: true }
      }

      await pageStore.openPage(page.id)
    } catch (error) {
      console.error('[beforeEach /page] Failed to load page:', error)
      return { name: 'journal-list' }
    }
  }

  if (to.name === 'journal-page') {
    try {
      const { normalizeJournalTitle } = await import('../utils/journal-detect')

      const rawParam = to.params.date as string
      const normalized = normalizeJournalTitle(rawParam)

      if (!normalized) {
        return { name: 'page', params: { pageId: rawParam } }
      }

      let page = pageStore.getPageByTitle(normalized)

      if (!page) {
        page = await pageStore.createPage(normalized, 'journal')
      }

      if (page && page.type !== 'journal') {
        return { name: 'page', params: { pageId: normalized } }
      }

      await pageStore.openPage(page.id)
    } catch (error) {
      console.error('[beforeEach /journal] Failed to load page:', error)
      return { name: 'journal-list' }
    }
  }
})

export default router