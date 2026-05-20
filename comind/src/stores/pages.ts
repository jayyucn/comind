import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Page } from '../types/page'
import { storage } from '../storage/indexedDB'
import { useBlockStore } from './blocks'
import { useFavorites } from '../composables/useFavorites'

export const usePageStore = defineStore('pages', () => {
  const pages = ref<Page[]>([])
  const currentPageId = ref<string>('')
  const loading = ref(false)
  const trashPages = ref<Page[]>([])

  /** 从 IndexedDB 加载所有 Page 到内存 */
  async function loadAllPages() {
    loading.value = true
    try {
      pages.value = await storage.getAllPages()
    } finally {
      loading.value = false
    }
  }

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
    if (!title.trim()) return undefined
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

  /** 加载回收站页面 */
  async function loadTrashPages() {
    trashPages.value = await storage.getTrashedPages()
  }

  /** 软删除页面（移至回收站） */
  async function softDeletePage(pageId: string): Promise<void> {
    await storage.softDeletePage(pageId)
    pages.value = pages.value.filter(p => p.id !== pageId)
    if (currentPageId.value === pageId) {
      currentPageId.value = ''
    }
    const { removeFavorite } = useFavorites()
    removeFavorite(pageId)
  }

  /** 恢复页面（从回收站还原） */
  async function restorePage(pageId: string): Promise<void> {
    await storage.restorePage(pageId)
    trashPages.value = trashPages.value.filter(p => p.id !== pageId)
    await loadAllPages()
  }

  /** 永久删除页面 */
  async function permanentDeletePage(pageId: string): Promise<void> {
    await storage.permanentDeletePage(pageId)
    trashPages.value = trashPages.value.filter(p => p.id !== pageId)
    if (currentPageId.value === pageId) {
      currentPageId.value = ''
    }
  }

  return { pages, currentPageId, loading, trashPages, loadAllPages, openPage, createPage, getPage, getPageByTitle, renamePage, mergePage, deletePage, loadTrashPages, softDeletePage, restorePage, permanentDeletePage }
})
