import type { RouteRecordRaw } from 'vue-router'
import { logger } from '../utils/logger'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/journal',
  },
  {
    path: '/journal',
    name: 'journal-list',
    component: () => import('../components/Journal/JournalList.vue'),
  },
  {
    path: '/journal/:date',
    name: 'journal-page',
    component: () => import('../components/Page/index.vue'),
    props: (route) => ({ pageId: route.params.date as string }),
    beforeEnter: async (to) => {
      try {
        const { usePageStore } = await import('../stores/pages')
        const { storage } = await import('../storage/indexedDB')
        const { normalizeJournalTitle } = await import('../utils/journal-detect')
        
        const pageStore = usePageStore()
        await pageStore.loadAllPages()
        
        const rawParam = to.params.date as string
        const normalized = normalizeJournalTitle(rawParam)
        
        // 关键：/journal 路由仅接受日记格式
        // 非日记格式（如 "我的笔记"）应重定向到 /page 路由
        if (!normalized) {
          console.warn(`[beforeEnter /journal/:date] Non-journal title "${rawParam}", redirecting to /page`)
          return { name: 'page', params: { pageId: rawParam } }
        }
        
        const lookupTitle = normalized
        
        // journal 路由：先按 title 查找，再 IDB fallback
        let page = pageStore.getPageByTitle(lookupTitle)
        
        if (!page) {
          page = await storage.getPage(lookupTitle)
          if (page) {
            // 同步到内存缓存
            if (!pageStore.pages.find(p => p.id === page!.id)) {
              pageStore.pages.push(page)
            }
          }
        }
        
        // 找到了页面，但类型不对 → 重定向到 /page
        if (page && page.type !== 'journal') {
          console.warn(`[beforeEnter /journal/:date] Page "${lookupTitle}" is not journal type, redirecting to /page`)
          return { name: 'page', params: { pageId: lookupTitle } }
        }
        
        // 页面不存在 → 创建 journal 类型页面
        if (!page) {
          page = await pageStore.createPage(lookupTitle, 'journal')
        }
        
        await pageStore.openPage(page.id)
      } catch (error) {
        console.error('[beforeEnter /journal/:date] Failed to load page:', error)
        return { name: 'journal-list' }
      }
    },
  },
  {
    path: '/page/:pageId',
    name: 'page',
    component: () => import('../components/Page/index.vue'),
    props: (route) => ({ pageId: route.params.pageId as string }),
    beforeEnter: async (to) => {
      try {
        const { usePageStore } = await import('../stores/pages')
        const { storage } = await import('../storage/indexedDB')
        
        const pageStore = usePageStore()
        await pageStore.loadAllPages()
        
        const rawParam = to.params.pageId as string
        
        // page 路由：先按 UUID 查找，再按 title 查找
        let page = pageStore.getPage(rawParam) ?? pageStore.getPageByTitle(rawParam)
        
        if (!page) {
          page = await storage.getById(rawParam) ?? await storage.getPage(rawParam)
          if (page) {
            // 同步到内存缓存
            if (!pageStore.pages.find(p => p.id === page!.id)) {
              pageStore.pages.push(page)
            }
          }
        }
        
        // 找到了页面，但类型是 journal → 重定向到 /journal
        if (page && page.type === 'journal') {
          console.warn(`[beforeEnter /page/:pageId] Page "${rawParam}" is journal type, redirecting to /journal`)
          return { name: 'journal-page', params: { date: page.title } }
        }
        
        // 页面不存在 → 创建 normal 类型页面
        if (!page) {
          page = await pageStore.createPage(rawParam, 'normal')
        }
        
        await pageStore.openPage(page.id)
      } catch (error) {
        logger.error('[beforeEnter /page/:pageId] Failed to load page:', error)
        return { name: 'journal-list' }
      }
    },
  },
  // 404 兜底
  {
    path: '/:pathMatch(.*)*',
    redirect: '/journal',
  },
]

export default routes
