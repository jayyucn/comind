import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { initCoreClient } from '../wasm/client'
import type { BlockCard } from '../wasm/types'
import type { CoreClient } from '../wasm/client'

let coreClientPromise: Promise<CoreClient> | null = null

async function getClient(): Promise<CoreClient> {
  if (!coreClientPromise) {
    coreClientPromise = initCoreClient()
  }
  const client = await coreClientPromise
  if (!client) throw new Error('Core client not initialized')
  return client
}

export const useBlockCardStore = defineStore('blockCard', () => {
  const cards = ref<BlockCard[]>([])
  const loading = ref(false)
  const dirtyIds = ref<Set<string>>(new Set())
  const isFullyDirty = ref(false)

  /** Load all block cards from backend */
  async function load(): Promise<BlockCard[]> {
    loading.value = true
    try {
      const client = await getClient()
      cards.value = await client.getBlockCards()
      dirtyIds.value = new Set()
      isFullyDirty.value = false
      return cards.value
    } finally {
      loading.value = false
    }
  }

  /** Mark a specific block card as dirty (or all if no blockId) */
  function invalidate(blockId?: string): void {
    if (blockId) {
      dirtyIds.value.add(blockId)
    } else {
      isFullyDirty.value = true
    }
  }

  /** Refresh dirty cards before querying */
  async function refreshIfDirty(): Promise<void> {
    // 全脏或局部脏都全量重拉：脏卡片数据已过期，不能只剔除——
    // 剔除会让下游拿到残缺数据（如 project/area 已有值列表缺失刚保存的值）
    if (isFullyDirty.value || dirtyIds.value.size > 0) {
      await load()
    }
  }

  /** Get cards, refreshing if needed */
  async function getCards(): Promise<BlockCard[]> {
    await refreshIfDirty()
    if (cards.value.length === 0 && !loading.value) {
      await load()
    }
    return cards.value
  }

  const cardCount = computed(() => cards.value.length)

  return {
    cards,
    loading,
    cardCount,
    load,
    invalidate,
    refreshIfDirty,
    getCards,
  }
})
