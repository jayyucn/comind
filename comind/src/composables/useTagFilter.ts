import { computed, ref } from 'vue'
import { useBlockStore } from '../stores/blocks'
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

/** 根据标签过滤预加载的结果 */
function filterByTag(tag: string, all: Array<{ block: Block; pageTitle: string }>): Array<{ block: Block; pageTitle: string }> {
  const tagLower = tag.toLowerCase()
  const escaped = tagLower.replace('/', '\\/')
  const regex = new RegExp(`#${escaped}(?:/|$)`, 'g')

  return all.filter(item => {
    const content = item.block.content.toLowerCase()
    return regex.test(content)
  })
}

export function useTagFilter() {
  const blockStore = useBlockStore()
  const pageStore = usePageStore()

  /** 打开筛选：预加载全量 Blocks 再搜索 */
  async function openFilter(tag: string) {
    activeTag.value = tag

    // 首次打开时预加载；后续直接用缓存
    if (!cachedAllBlocks) {
      const all = await preloadAllBlocks(pageStore)
      void all // 已在 preloadAllBlocks 中写入 cachedAllBlocks
    }
  }

  /** 关闭筛选 */
  function closeFilter() {
    activeTag.value = null
  }

  /** 所有含有 activeTag 的 Block，按 Page 分组 */
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

  /** 跳转到某个 Block */
  async function navigateToBlock(blockId: string) {
    const targetBlock = groupedResults.value.find(r => r.block.id === blockId)?.block
      ?? blockStore.blocks.find(b => b.id === blockId)
    if (!targetBlock) return

    await pageStore.openPage(targetBlock.pageId)
    // 等页面加载完成后激活
    setTimeout(async () => {
      const { useEditorStore } = await import('../stores/editor')
      useEditorStore().activateBlock(blockId)
    }, 100)
    closeFilter()
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