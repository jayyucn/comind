import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Page } from '../types/page'
import { initCoreClient } from '../wasm/client'
import { useBlockStore } from './blocks'
import { useFavorites } from '../composables/useFavorites'
import { parseIdeasSnapshotContent, type IdeasSnapshotData } from '../utils/ideas-snapshot'

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

  // ── Ideas 页快照：纯快照驱动历史列表（ADR-0042 T5）──
  // 列表只消费 ideasSnapshots，按月异步获取：
  // - loadIdeasSnapshotMonths：异步拉「有快照的月份」列表（轻量，不含 content_json），挂载即调
  // - loadIdeasSnapshotsByMonth(month)：选中/切换月份时异步拉该月快照，并入 ideasSnapshots
  // 不再一次性全量加载 content_json；today/未来/非日期标题的页本就不会物化，天然排除。
  const ideasSnapshotMonths = ref<string[]>([])
  let monthsLoaded = false
  const monthLoadPromises = new Map<string, Promise<void>>()

  async function loadIdeasSnapshotMonths() {
    if (monthsLoaded) return
    const client = await getClient()
    ideasSnapshotMonths.value = await client.listIdeasSnapshotMonths()
    monthsLoaded = true
  }

  async function loadIdeasSnapshotsByMonth(month: string) {
    if (!month) return
    if (monthLoadPromises.has(month)) return monthLoadPromises.get(month)
    const promise = (async () => {
      const [y, m] = month.split('-').map(Number)
      const client = await getClient()
      const list = await client.listIdeasSnapshotsByMonth(y, m)
      const map = { ...ideasSnapshots.value }
      for (const s of list) {
        map[s.pageId] = s.content ? parseIdeasSnapshotContent(s.content, s.date) : null
      }
      ideasSnapshots.value = map
    })()
    monthLoadPromises.set(month, promise)
    try {
      await promise
    } finally {
      monthLoadPromises.delete(month)
    }
  }

  /** 有快照的月份列表（yyyy-MM，倒序），供 MonthPicker */
  const ideasMonths = computed<string[]>(() => ideasSnapshotMonths.value)

  /** 某月的历史页清单（{pageId, title}，按标题倒序），供历史列表渲染 */
  function ideasHistoryPages(month: string): { pageId: string; title: string }[] {
    return Object.entries(ideasSnapshots.value)
      .filter(([, s]) => !!s && s.title.startsWith(month))
      .map(([pageId, s]) => ({ pageId, title: s!.title }))
      .sort((a, b) => b.title.localeCompare(a.title))
  }

  /**
   *
   * - 调用 Rust 命令 `ensure_today_ideas_page`：已存在则返回，不存在则创建
   * - 返回的页面会合并到 pages.value（已存在则原地更新，否则新增）
   * - 解决 IdeasTodayPanel 因 TS 端缓存 stale 导致的不显示问题
   */
  async function ensureTodayIdeasPage(): Promise<Page> {
    const client = await getClient()
    const rustPage = await client.ensureTodayIdeasPage()

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

    // 合并到 pages.value：已存在则原地更新（避免响应式丢失），否则新增
    const existingIdx = pages.value.findIndex(p => p.id === page.id)
    if (existingIdx >= 0) {
      pages.value[existingIdx] = page
    } else {
      pages.value.push(page)
    }

    return page
  }

  function setCurrentPage(pageId: string) {
    currentPageId.value = pageId
  }

  // ── Ideas 页快照读取（ADR-0042 T5 快照读取守卫）──
  // 快照不可变 → 会话内缓存安全；null 也缓存（该页尚无快照，本次会话不再重试）。
  const ideasSnapshots = ref<Record<string, IdeasSnapshotData | null>>({})

  /**
   * 读取 ideas 页快照渲染数据（仅历史页有快照；今日/未过期/无快照 → null）。
   * 页面渲染方经守卫（utils/ideas-snapshot isStaleIdeasPage）先判模式，再调此方法取内容。
   */
  async function getIdeasSnapshot(pageId: string): Promise<IdeasSnapshotData | null> {
    if (pageId in ideasSnapshots.value) return ideasSnapshots.value[pageId]
    const client = await getClient()
    const { content, date } = await client.getIdeasSnapshot(pageId)
    const data = content ? parseIdeasSnapshotContent(content, date ?? '') : null
    ideasSnapshots.value[pageId] = data
    return data
  }

  // 保证 loadAllPages 在守卫 get-or-create 前完成一次，
  // 避免刷新时内存缓存未加载导致 getPage/getPageByTitle 双 miss 而误建垃圾 Page。
  let pagesReady: Promise<void> | null = null
  function ensurePagesLoaded(): Promise<void> {
    if (!pagesReady) {
      pagesReady = loadAllPages().catch((err) => {
        console.warn('[pages] ensurePagesLoaded failed:', err)
      })
    }
    return pagesReady
  }

  async function openPage(pageId: string) {
    setCurrentPage(pageId)
    const blockStore = useBlockStore()
    await blockStore.ensurePageBlocks(pageId)
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
    const rustPages = await client.getTrashPages()
    trashPages.value = rustPages.map(rustPage => ({
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
      deletedAt: rustPage.deleted_at ?? rustPage.updated_at,
    }))
  }

  /** 软删除页面（移至回收站） */
  async function softDeletePage(pageId: string): Promise<void> {
    const client = await getClient()
    const page = getPage(pageId)
    if (page) {
      await client.executeBatch([{
        entity: 'page',
        action: 'delete',
        params: { id: pageId },
      }])
      trashPages.value = [
        { ...page, deleted: true, deletedAt: Date.now() },
        ...trashPages.value.filter(p => p.id !== pageId),
      ]
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

  return { pages, currentPageId, loading, trashPages, loadAllPages, ensurePagesLoaded, ensureTodayIdeasPage, getIdeasSnapshot, loadIdeasSnapshotMonths, loadIdeasSnapshotsByMonth, ideasSnapshots, ideasMonths, ideasHistoryPages, setCurrentPage, openPage, createPage, getPage, getPageByTitle, getOrCreatePageByTitle, renamePage, mergePage, deletePage, loadTrashPages, softDeletePage, restorePage, permanentDeletePage, onRemovePageFromHistory }
})
