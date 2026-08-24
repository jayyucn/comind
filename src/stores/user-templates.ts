import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { UserTemplate } from '../types/template'
import { initCoreClient } from '../wasm/client'

export interface CreateTemplateInput {
  name: string
  description?: string
  category?: string
  sourcePageId: string
  blocks: UserTemplate['blocks']
}

let clientPromise: ReturnType<typeof initCoreClient> | null = null

async function getClient() {
  if (!clientPromise) {
    clientPromise = initCoreClient()
  }
  return clientPromise
}

export const useUserTemplatesStore = defineStore('user-templates', () => {
  const templates = ref<UserTemplate[]>([])

  async function loadAll(): Promise<void> {
    const client = await getClient()
    const coreTemplates = await client.getTemplates()
    templates.value = coreTemplates.map(t => ({
      id: t.id,
      name: t.name,
      category: t.category,
      description: '',
      sourcePageId: '',
      blocks: [],
      createdAt: t.created_at,
      updatedAt: t.updated_at
    }))
  }

  async function create(input: CreateTemplateInput): Promise<UserTemplate> {
    const client = await getClient()
    const record: UserTemplate = {
      id: `template_${Date.now()}`,
      name: input.name,
      description: input.description ?? '',
      category: input.category ?? 'custom',
      sourcePageId: input.sourcePageId,
      blocks: input.blocks,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    await client.executeBatch([{
      entity: 'template',
      action: 'create',
      params: {
        id: record.id,
        name: record.name,
        category: record.category,
        content: JSON.stringify({
          description: record.description,
          sourcePageId: record.sourcePageId,
          blocks: record.blocks
        })
      }
    }])
    templates.value = [...templates.value, record]
    return record
  }

  async function remove(id: string): Promise<void> {
    const client = await getClient()
    await client.executeBatch([{
      entity: 'template',
      action: 'delete',
      params: { id }
    }])
    templates.value = templates.value.filter(t => t.id !== id)
  }

  async function rename(id: string, newName: string): Promise<void> {
    const client = await getClient()
    try {
      await client.executeBatch([{
        entity: 'template',
        action: 'update',
        params: { id, name: newName }
      }])
      const idx = templates.value.findIndex(t => t.id === id)
      if (idx !== -1) {
        templates.value[idx] = { ...templates.value[idx], name: newName, updatedAt: Date.now() }
      }
    } catch (e) {
      // Template not found - ignore silently
    }
  }

  async function update(id: string, patch: Partial<Omit<UserTemplate, 'id' | 'createdAt'>>): Promise<void> {
    const client = await getClient()
    try {
      const params: Record<string, any> = { id }
      if (patch.name !== undefined) params.name = patch.name
      if (patch.description !== undefined) params.description = patch.description
      if (patch.category !== undefined) params.category = patch.category
      if (patch.sourcePageId !== undefined) params.sourcePageId = patch.sourcePageId
      if (patch.blocks !== undefined) params.blocks = patch.blocks
      await client.executeBatch([{
        entity: 'template',
        action: 'update',
        params
      }])
      const idx = templates.value.findIndex(t => t.id === id)
      if (idx !== -1) {
        templates.value[idx] = { ...templates.value[idx], ...patch, updatedAt: Date.now() }
      }
    } catch (e) {
      // Template not found - ignore silently
    }
  }

  return { templates, loadAll, create, remove, rename, update }
})