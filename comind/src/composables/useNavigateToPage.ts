import { useRouter } from 'vue-router'
import { usePageStore } from '../stores/pages'
import { storage } from '../storage/indexedDB'
import { normalizeJournalTitle } from '../utils/journal-detect'

export function useNavigateToPage() {
  const router = useRouter()
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
      // 根据页面类型路由
      if (page.type === 'journal') {
        router.push(`/journal/${page.title}`)
      } else {
        router.push(`/page/${page.id}`)
      }
    } else {
      const newPage = await pageStore.createPage(lookupTitle, pageType)
      // 根据页面类型路由
      if (newPage.type === 'journal') {
        router.push(`/journal/${newPage.title}`)
      } else {
        router.push(`/page/${newPage.id}`)
      }
    }
  }

  return { navigateToPage }
}
