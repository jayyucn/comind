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

  return { pages, currentPageId, loading, loadAllPages, openPage, createPage, getPage }
})
