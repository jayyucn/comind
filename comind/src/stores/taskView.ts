import { defineStore } from 'pinia'
import { ref } from 'vue'
import { initCoreClient } from '../wasm/client'
import type { CoreClient } from '../wasm/client'
import type { TaskViewRust } from '../wasm/types'
import type { BlockQuery } from '../types/blockQuery'

let coreClientPromise: Promise<CoreClient> | null = null

async function getClient(): Promise<CoreClient> {
  if (!coreClientPromise) {
    coreClientPromise = initCoreClient()
  }
  const client = await coreClientPromise
  if (!client) throw new Error('Core client not initialized')
  return client
}

export const useTaskViewStore = defineStore('taskView', () => {
  const views = ref<TaskViewRust[]>([])
  const currentViewId = ref<string | null>(null)
  const loading = ref(false)

  async function load(): Promise<TaskViewRust[]> {
    loading.value = true
    try {
      const client = await getClient()
      views.value = await client.getTaskViews()

      // Auto-create default "全部任务" view if none exist
      if (views.value.length === 0) {
        const defaultQuery: BlockQuery = {
          filters: [{ field: { kind: 'property', key: 'status' }, op: 'hasAny', value: null }],
          sort: [],
          groupBy: null,
        }
        const view = await client.saveTaskView(
          '全部任务',
          JSON.stringify(defaultQuery),
          'table',
          ''
        )
        views.value.push(view)
        try {
          const updated = await client.setDefaultTaskView(view.id)
          const idx = views.value.findIndex(v => v.id === view.id)
          if (idx !== -1) {
            views.value[idx] = updated
          }
        } catch {
          // setDefault may fail silently in WASM
        }
      }

      // Set initial currentViewId to default view
      if (!currentViewId.value) {
        const defaultView = views.value.find(v => v.is_default === 1)
        if (defaultView) {
          currentViewId.value = defaultView.id
        } else if (views.value.length > 0) {
          currentViewId.value = views.value[0].id
        }
      }

      return views.value
    } finally {
      loading.value = false
    }
  }

  async function save(name: string, queryJson: string, viewType: string, groupBy: string): Promise<TaskViewRust> {
    const client = await getClient()
    const view = await client.saveTaskView(name, queryJson, viewType, groupBy)
    views.value.push(view)
    return view
  }

  async function update(id: string, name: string, queryJson: string, viewType: string, groupBy: string, isDefault: boolean, sortOrder: number): Promise<TaskViewRust> {
    const client = await getClient()
    const view = await client.updateTaskView(id, name, queryJson, viewType, groupBy, isDefault, sortOrder)
    const idx = views.value.findIndex(v => v.id === id)
    if (idx !== -1) {
      views.value[idx] = view
    }
    return view
  }

  async function remove(id: string): Promise<void> {
    const client = await getClient()
    await client.deleteTaskView(id)
    views.value = views.value.filter(v => v.id !== id)
    if (currentViewId.value === id) {
      currentViewId.value = views.value.length > 0 ? views.value[0].id : null
    }
  }

  async function setDefault(id: string): Promise<TaskViewRust> {
    const client = await getClient()
    const view = await client.setDefaultTaskView(id)
    // Update all views — only one should be default
    views.value = views.value.map(v => ({
      ...v,
      is_default: v.id === id ? 1 : 0,
    }))
    const idx = views.value.findIndex(v => v.id === id)
    if (idx !== -1) {
      views.value[idx] = view
    }
    return view
  }

  return {
    views,
    currentViewId,
    loading,
    load,
    save,
    update,
    remove,
    setDefault,
  }
})
