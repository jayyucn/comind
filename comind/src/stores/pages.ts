import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { PageRecord } from '../types/link'
import { storage } from '../storage/indexedDB'
import { useBlockStore } from './blocks'

export const usePageStore = defineStore('pages', () => {
  const pages = ref<PageRecord[]>([])
  const currentPageId = ref<string>('')
  const loading = ref(false)

  async function loadAllPages() {
    loading.value = true
    try {
      pages.value = await storage.getAllPages()
      // 空 IDB -> 创建第一个默认 page
      if (pages.value.length === 0) {
        await createPage('comind')
      }
    } finally {
      loading.value = false
    }
  }

  async function openPage(pageId: string) {
    currentPageId.value = pageId
    const blockStore = useBlockStore()
    await blockStore.loadPage(pageId)
  }

  async function createPage(title: string): Promise<PageRecord> {
    const page = await storage.createPage(title)
    pages.value.push(page)

    // 同时在 blocks 中创建对应的 Page Block
    const blockStore = useBlockStore()
    await blockStore.createBlock({
      pageId: page.id,
      content: '',
      isPage: true,
      title
    })

    return page
  }

  function getPage(pageId: string): PageRecord | undefined {
    return pages.value.find(p => p.id === pageId)
  }

  function getPageByTitle(title: string): PageRecord | undefined {
    return pages.value.find(p => p.title === title)
  }

  /** 重命名页面，返回重复信息（如有） */
  async function renamePage(pageId: string, newTitle: string): Promise<{ duplicated?: PageRecord }> {
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

  return { pages, currentPageId, loading, loadAllPages, openPage, createPage, getPage, getPageByTitle, renamePage, mergePage }
})
