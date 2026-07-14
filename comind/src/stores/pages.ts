import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Page } from '../types/page'
import { initCoreClient } from '../wasm/client'
import { useBlockStore } from './blocks'
import { useFavorites } from '../composables/useFavorites'

import type { CoreClient } from '../wasm/client'

let coreClientPromise: Promise<CoreClient> | null = null

async function getClient() {
  if (!coreClientPromise) {
    coreClientPromise = initCoreClient()
  }
  const client = await coreClientPromise
  if (!client) {
    throw new Error('Core client not initialized')
  }
  return client
}

export const usePageStore = defineStore('pages', () => {
  const pages = ref<Page[]>([])
  const currentPageId = ref<string>('')
  const loading = ref(false)
  const trashPages = ref<Page[]>([])
  let removePageFromHistoryFn: ((pageId: string) => void) | undefined

  function onRemovePageFromHistory(fn: (pageId: string) => void) {
    removePageFromHistoryFn = fn
  }

  /** 从 Rust Core 加载所有 Page 到内存 */
  async function loadAllPages() {
    loading.value = true
    try {
      const client = await getClient()
      const rustPages = await client.getAllPages()
      
      pages.value = rustPages.map(rustPage => ({
        id: rustPage.id,
        blockId: rustPage.block_id,
        title: rustPage.title,
        type: rustPage.type as Page['type'],
        icon: rustPage.icon,
        cover: rustPage.cover,
        aliases: JSON.parse(rustPage.aliases || '[]') as string[],
        filePath: rustPage.file_path,
        childrenCount: rustPage.children_count,
        wordCount: rustPage.word_count,
        createdAt: rustPage.created_at,
        updatedAt: rustPage.updated_at,
        deleted: rustPage.deleted === 1,
        deletedAt: null
      }))
    } finally {
      loading.value = false
    }
  }

  async function openPage(pageId: string) {
    currentPageId.value = pageId
    const blockStore = useBlockStore()
    await blockStore.loadPageBlocks(pageId)

    // 页面无 Block 时自动创建一个空的根级 Block
    if (blockStore.blocks.length === 0) {
      await blockStore.createBlock({
        pageId,
        content: '',
        parentId: null,
      })
    }
  }

  async function createPage(title: string, type: 'normal' | 'ideas' = 'normal'): Promise<Page> {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      throw new Error('Page title cannot be empty')
    }

    // 幂等：并发时可能已被另一方创建，直接复用
    const existingPage = getPageByTitle(trimmedTitle)
    if (existingPage) return existingPage

    const client = await getClient()
    const rustPage = await client.savePage({ title: trimmedTitle, type })
    
    const page: Page = {
      id: rustPage.id,
      blockId: rustPage.block_id,
      title: rustPage.title,
      type: rustPage.type as Page['type'],
      icon: rustPage.icon,
      cover: rustPage.cover,
      aliases: JSON.parse(rustPage.aliases || '[]') as string[],
      filePath: rustPage.file_path,
      childrenCount: rustPage.children_count,
      wordCount: rustPage.word_count,
      createdAt: rustPage.created_at,
      updatedAt: rustPage.updated_at,
      deleted: rustPage.deleted === 1,
      deletedAt: null
    }
    
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

  /**
   * 根据标题查找页面；不存在则自动创建（"引用即创建" 模式）
   */
  async function getOrCreatePageByTitle(title: string): Promise<Page> {
    const trimmed = title.trim()
    if (!trimmed) throw new Error('Page title cannot be empty')
    const existing = getPageByTitle(trimmed)
    if (existing) return existing
    // 不存在 → 自动创建普通页面
    return await createPage(trimmed, 'normal')
  }

  /** 重命名页面，返回重复信息（如有） */
  async function renamePage(pageId: string, newTitle: string): Promise<{ duplicated?: Page }> {
    if (!newTitle.trim()) return {}
    const page = getPage(pageId)
    if (!page) return {}
    if (page.type === 'ideas') return {}
    const trimmedTitle = newTitle.trim()
    if (page.title === trimmedTitle) return {}

    const duplicate = getPageByTitle(trimmedTitle)
    if (duplicate && duplicate.id !== pageId) {
      return { duplicated: duplicate }
    }

    const client = await getClient()
    await client.savePage({ id: pageId, title: trimmedTitle, type: page.type })
    page.title = trimmedTitle
    return {}
  }

  /** 合并源页面到目标页面（事务操作） */
  async function mergePage(sourceId: string, targetId: string): Promise<void> {
    const client = await getClient()
    const sourceBlocks = await client.getBlocksByPage(sourceId)
    
    for (const rustBlock of sourceBlocks) {
      await client.saveBlockTree([{
        id: rustBlock.id,
        page_id: targetId,
        parent_id: rustBlock.parent_id,
        pos: rustBlock.pos,
        content: rustBlock.content,
        format: rustBlock.format,
        type: rustBlock.type,
        created_at: rustBlock.created_at,
        updated_at: Date.now()
      }])
    }
    
    await client.deletePageCascade(sourceId)
    pages.value = pages.value.filter(p => p.id !== sourceId)
    if (currentPageId.value === sourceId) {
      currentPageId.value = targetId
    }
  }

  /** 删除页面 */
  async function deletePage(pageId: string): Promise<void> {
    const client = await getClient()
    await client.deletePageCascade(pageId)
    pages.value = pages.value.filter(p => p.id !== pageId)
    if (currentPageId.value === pageId) {
      currentPageId.value = pages.value.length > 0 ? pages.value[0].id : ''
    }
    if (removePageFromHistoryFn) {
      removePageFromHistoryFn(pageId)
    }
  }

  /** 加载回收站页面 */
  async function loadTrashPages() {
    const client = await getClient()
    const rustPages = await client.getAllPages()
    trashPages.value = rustPages
      .filter(rustPage => rustPage.deleted === 1)
      .map(rustPage => ({
        id: rustPage.id,
        blockId: rustPage.block_id,
        title: rustPage.title,
        type: rustPage.type as Page['type'],
        icon: rustPage.icon,
        cover: rustPage.cover,
        aliases: JSON.parse(rustPage.aliases || '[]') as string[],
        filePath: rustPage.file_path,
        childrenCount: rustPage.children_count,
        wordCount: rustPage.word_count,
        createdAt: rustPage.created_at,
        updatedAt: rustPage.updated_at,
        deleted: true,
        deletedAt: null
      }))
  }

  /** 软删除页面（移至回收站） */
  async function softDeletePage(pageId: string): Promise<void> {
    const client = await getClient()
    const page = getPage(pageId)
    if (page) {
      await client.savePage({ 
        id: pageId, 
        title: page.title, 
        type: page.type 
      })
    }
    pages.value = pages.value.filter(p => p.id !== pageId)
    if (currentPageId.value === pageId) {
      currentPageId.value = ''
    }
    const { removeFavorite } = useFavorites()
    removeFavorite(pageId)
    if (removePageFromHistoryFn) {
      removePageFromHistoryFn(pageId)
    }
  }

  /** 恢复页面（从回收站还原） */
  async function restorePage(pageId: string): Promise<void> {
    const client = await getClient()
    const page = getPage(pageId)
    if (page) {
      await client.savePage({ 
        id: pageId, 
        title: page.title, 
        type: page.type 
      })
    }
    trashPages.value = trashPages.value.filter(p => p.id !== pageId)
    await loadAllPages()
  }

  /** 永久删除页面 */
  async function permanentDeletePage(pageId: string): Promise<void> {
    const client = await getClient()
    await client.deletePageCascade(pageId)
    pages.value = pages.value.filter(p => p.id !== pageId)
    trashPages.value = trashPages.value.filter(p => p.id !== pageId)
    if (currentPageId.value === pageId) {
      currentPageId.value = ''
    }
    const { removeFavorite } = useFavorites()
    removeFavorite(pageId)
    if (removePageFromHistoryFn) {
      removePageFromHistoryFn(pageId)
    }
  }

  return { pages, currentPageId, loading, trashPages, loadAllPages, openPage, createPage, getPage, getPageByTitle, getOrCreatePageByTitle, renamePage, mergePage, deletePage, loadTrashPages, softDeletePage, restorePage, permanentDeletePage, onRemovePageFromHistory }
})
