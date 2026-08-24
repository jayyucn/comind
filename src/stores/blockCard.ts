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
    if (isFullyDirty.value) {
      await load()
      return
    }
    if (dirtyIds.value.size === 0) return

    // Remove dirty cards from local array (they'll be re-fetched or gone)
    const dirtySet = dirtyIds.value
    cards.value = cards.value.filter(c => !dirtySet.has(c.block_id))
    dirtyIds.value = new Set()
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
