import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Page } from '../types/page'
import { storage } from '../storage/indexedDB'
import { useBlockStore } from './blocks'

export const usePageStore = defineStore('pages', () => {
  const pages = ref<Page[]>([])
  const currentPageId = ref<string>('')
  const loading = ref(false)

  async function openPage(pageId: string) {
    currentPageId.value = pageId
    const blockStore = useBlockStore()
    await blockStore.loadPageBlocks(pageId)
  }

  async function createPage(title: string, type: 'normal' | 'journal' = 'normal'): Promise<Page> {
    const page = await storage.createPageWithRootBlock(title, type)
    pages.value.push(page)
    return page
  }

  function getPage(pageId: string): Page | undefined {
    return pages.value.find(p => p.id === pageId)
  }

  function getPageByTitle(title: string): Page | undefined {
    return pages.value.find(p => p.title === title)
  }

  

  /** 重命名页面，返回重复信息（如有） */
  async function renamePage(pageId: string, newTitle: string): Promise<{ duplicated?: Page }> {
    if (!newTitle.trim()) return {}
    const page = getPage(pageId)
    if (!page) return {}
    const trimmedTitle = newTitle.trim()
    if (page.title === trimmedTitle) return {}

    const duplicate = getPageByTitle(trimmedTitle)
    if (duplicate && duplicate.id !== pageId) {
      return { duplicated: duplicate }
    }

    await storage.renamePage(pageId, trimmedTitle)
    page.title = trimmedTitle
    return {}
  }

  /** 合并源页面到目标页面（事务操作） */
  async function mergePage(sourceId: string, targetId: string): Promise<void> {
    await storage.mergePage(sourceId, targetId)
    pages.value = pages.value.filter(p => p.id !== sourceId)
    if (currentPageId.value === sourceId) {
      currentPageId.value = targetId
    }
  }

  /** 删除页面 */
  async function deletePage(pageId: string): Promise<void> {
    await storage.deletePage(pageId)
    pages.value = pages.value.filter(p => p.id !== pageId)
    if (currentPageId.value === pageId) {
      currentPageId.value = pages.value.length > 0 ? pages.value[0].id : ''
    }
  }

  return { pages, currentPageId, loading, openPage, createPage, getPage, getPageByTitle, renamePage, mergePage, deletePage }
})
