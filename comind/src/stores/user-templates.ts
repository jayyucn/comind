import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { UserTemplate } from '../types/template'
import { db } from '../storage/db'
import { generateUUID } from '../utils/id'

export interface CreateTemplateInput {
  name: string
  description?: string
  category?: string
  sourcePageId: string
  blocks: UserTemplate['blocks']
}

export const useUserTemplatesStore = defineStore('user-templates', () => {
  const templates = ref<UserTemplate[]>([])

  async function loadAll(): Promise<void> {
    templates.value = await db.templates.toArray()
  }

  async function create(input: CreateTemplateInput): Promise<UserTemplate> {
    const now = Date.now()
    const record: UserTemplate = {
      id: generateUUID(),
      name: input.name,
      description: input.description,
      category: input.category ?? 'custom',
      sourcePageId: input.sourcePageId,
      blocks: input.blocks,
      createdAt: now,
      updatedAt: now,
    }
    await db.templates.put(record)
    templates.value = [...templates.value, record]
    return record
  }

  async function remove(id: string): Promise<void> {
    await db.templates.delete(id)
    templates.value = templates.value.filter(t => t.id !== id)
  }

  async function rename(id: string, newName: string): Promise<void> {
    const idx = templates.value.findIndex(t => t.id === id)
    if (idx === -1) return
    // JSON 往返：解包 Vue Proxy（结构化克隆仍会失败，因为 spread 只解一层）
    const updated = JSON.parse(JSON.stringify({ ...templates.value[idx], name: newName, updatedAt: Date.now() }))
    await db.templates.put(updated)
    templates.value.splice(idx, 1, updated)
  }

  async function update(id: string, patch: Partial<Omit<UserTemplate, 'id' | 'createdAt'>>): Promise<void> {
    const idx = templates.value.findIndex(t => t.id === id)
    if (idx === -1) return
    // JSON 往返：解包 Vue Proxy（结构化克隆仍会失败，因为 spread 只解一层）
    const updated = JSON.parse(JSON.stringify({ ...templates.value[idx], ...patch, updatedAt: Date.now() }))
    await db.templates.put(updated)
    templates.value.splice(idx, 1, updated)
  }

  return { templates, loadAll, create, remove, rename, update }
})
