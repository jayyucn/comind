import { defineStore } from 'pinia'
import { ref } from 'vue'
import { initCoreClient } from '../wasm/client'
import type { CoreClient } from '../wasm/client'
import type { SavedFilterRust } from '../wasm/types'

let coreClientPromise: Promise<CoreClient> | null = null

async function getClient(): Promise<CoreClient> {
  if (!coreClientPromise) {
    coreClientPromise = initCoreClient()
  }
  const client = await coreClientPromise
  if (!client) throw new Error('Core client not initialized')
  return client
}

export const useSavedFilterStore = defineStore('savedFilter', () => {
  const filters = ref<SavedFilterRust[]>([])
  const loading = ref(false)

  async function load(): Promise<SavedFilterRust[]> {
    loading.value = true
    try {
      const client = await getClient()
      filters.value = await client.getSavedFilters()
      return filters.value
    } finally {
      loading.value = false
    }
  }

  async function save(name: string, queryJson: string): Promise<SavedFilterRust> {
    const client = await getClient()
    const filter = await client.saveSavedFilter(name, queryJson)
    filters.value.push(filter)
    return filter
  }

  async function update(id: string, name: string, queryJson: string): Promise<SavedFilterRust> {
    const client = await getClient()
    const filter = await client.updateSavedFilter(id, name, queryJson)
    const idx = filters.value.findIndex(f => f.id === id)
    if (idx !== -1) {
      filters.value[idx] = filter
    }
    return filter
  }

  async function remove(id: string): Promise<void> {
    const client = await getClient()
    await client.deleteSavedFilter(id)
    filters.value = filters.value.filter(f => f.id !== id)
  }

  return {
    filters,
    loading,
    load,
    save,
    update,
    remove,
  }
})
