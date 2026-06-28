import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { UserTemplate } from '../types/template'
import { getCore } from '../core'

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
    const core = getCore()
    const result = await core.templateService.getAll()
    templates.value = result
  }

  async function create(input: CreateTemplateInput): Promise<UserTemplate> {
    const core = getCore()
    const record = await core.templateService.create({
      name: input.name,
      description: input.description,
      category: input.category ?? 'custom',
      sourcePageId: input.sourcePageId,
      blocks: input.blocks,
    })
    templates.value = [...templates.value, record]
    return record
  }

  async function remove(id: string): Promise<void> {
    const core = getCore()
    await core.templateService.delete(id)
    templates.value = templates.value.filter(t => t.id !== id)
  }

  async function rename(id: string, newName: string): Promise<void> {
    const core = getCore()
    try {
      const updated = await core.templateService.update(id, { name: newName })
      const idx = templates.value.findIndex(t => t.id === id)
      if (idx !== -1) {
        templates.value.splice(idx, 1, updated)
      }
    } catch (e) {
      // Template not found - ignore silently
    }
  }

  async function update(id: string, patch: Partial<Omit<UserTemplate, 'id' | 'createdAt'>>): Promise<void> {
    const core = getCore()
    try {
      const updated = await core.templateService.update(id, patch)
      const idx = templates.value.findIndex(t => t.id === id)
      if (idx !== -1) {
        templates.value.splice(idx, 1, updated)
      }
    } catch (e) {
      // Template not found - ignore silently
    }
  }

  return { templates, loadAll, create, remove, rename, update }
})
