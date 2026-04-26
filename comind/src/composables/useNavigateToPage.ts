import { usePageStore } from '../stores/pages'
import { storage } from '../storage/indexedDB'
import { inferPageType } from '../utils/journal-detect'

export function useNavigateToPage() {
  const pageStore = usePageStore()

  async function navigateToPage(pageName: string): Promise<void> {
    let page = pageStore.getPageByTitle(pageName)
    if (!page) {
      page = await storage.getPage(pageName)
    }
    if (page) {
      await pageStore.openPage(page.id)
    } else {
      
      const newPage = await pageStore.createPage(pageName, inferPageType(pageName))
      await pageStore.openPage(newPage.id)
    }
  }

  return { navigateToPage }
}
