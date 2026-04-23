import { computed, ref } from 'vue'
import { usePageStore } from '../stores/pages'
import { storage } from '../storage/indexedDB'
import type { Block } from '../types/block'

// ── 模块级状态（单例）──────────────────────────────────────────
const activeTag = ref<string | null>(null)
const isOpen = computed(() => activeTag.value !== null)

// 预加载的跨页全量结果（缓存在模块变量中）
let cachedAllBlocks: Array<{ block: Block; pageTitle: string }> | null = null

/** 预加载全量 Block 数据（一次性从 IndexedDB 获取） */
async function preloadAllBlocks(pageStore: ReturnType<typeof usePageStore>): Promise<Array<{ block: Block; pageTitle: string }>> {
  if (cachedAllBlocks) return cachedAllBlocks

  const allBlocks = await storage.getAllBlocks()
  const results: Array<{ block: Block; pageTitle: string }> = []

  for (const block of allBlocks) {
    if (block.isPage) continue
    const page = pageStore.getPage(block.pageId)
    results.push({ block, pageTitle: page?.title ?? 'Unknown' })
  }

  cachedAllBlocks = results
  return results
}

/** 清除缓存（blocks.ts 在 create/update/delete 后调用以保证数据新鲜） */
export function invalidateTagCache() {
  cachedAllBlocks = null
}

/** 根据标签过滤预加载的结果 */
function filterByTag(tag: string, all: Array<{ block: Block; pageTitle: string }>): Array<{ block: Block; pageTitle: string }> {
  const tagLower = tag.toLowerCase()
  const escaped = tagLower.replace('/', '\\/')
  const regex = new RegExp(`#${escaped}(?:/|$)`, 'gi')

  return all.filter(item => {
    const content = item.block.content
    return regex.test(content)
  })
}

export function useTagFilter() {
  const pageStore = usePageStore()

  /** 打开筛选：先预加载全量 Blocks，再设置 activeTag（避免竞态） */
  async function openFilter(tag: string) {
    // 必须先 await 预加载完成，再设置 activeTag
    // 否则 groupedResults computed 会在 cachedAllBlocks 为 null 时触发，返回空 []
    await preloadAllBlocks(pageStore)
    activeTag.value = tag
  }

  /** 关闭筛选 */
  function closeFilter() {
    activeTag.value = null
  }

  /** 所有含有 activeTag 的 Block */
  const groupedResults = computed(() => {
    if (!activeTag.value || !cachedAllBlocks) return []
    return filterByTag(activeTag.value, cachedAllBlocks)
  })

  /** 按 Page 分组 */
  const byPage = computed(() => {
    const map = new Map<string, typeof groupedResults.value>()
    for (const item of groupedResults.value) {
      if (!map.has(item.pageTitle)) map.set(item.pageTitle, [])
      map.get(item.pageTitle)!.push(item)
    }
    return map
  })

  /** 跳转到某个 Block（跨页导航） */
  async function navigateToBlock(blockId: string) {
    // 从 groupedResults 查找（已包含所有页的 block）
    const item = groupedResults.value.find(r => r.block.id === blockId)
    const targetBlock = item?.block
    if (!targetBlock) return

    closeFilter()

    await pageStore.openPage(targetBlock.pageId)
    // 等页面加载完成后激活 Block
    setTimeout(async () => {
      const { useEditorStore } = await import('../stores/editor')
      useEditorStore().activateBlock(blockId)
    }, 100)
  }

  return {
    activeTag,
    isOpen,
    groupedResults,
    byPage,
    openFilter,
    closeFilter,
    navigateToBlock,
  }
}