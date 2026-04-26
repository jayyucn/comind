import { usePageStore } from '../stores/pages'
import { storage } from '../storage/indexedDB'
import { normalizeJournalTitle } from '../utils/journal-detect'

export function useNavigateToPage() {
  const pageStore = usePageStore()

  async function navigateToPage(pageName: string): Promise<void> {
    // 日记标题规范化：[[2026/04/26]] → 查找/创建 "2026-04-26"
    const normalized = normalizeJournalTitle(pageName)
    const lookupTitle = normalized ?? pageName
    const pageType = normalized ? 'journal' : 'normal'

    let page = pageStore.getPageByTitle(lookupTitle)
    if (!page) {
      page = await storage.getPage(lookupTitle)
    }
    if (page) {
      await pageStore.openPage(page.id)
    } else {
      const newPage = await pageStore.createPage(lookupTitle, pageType)
      await pageStore.openPage(newPage.id)
    }
  }

  return { navigateToPage }
}
