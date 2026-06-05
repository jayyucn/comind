import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { UserTemplate } from '../types/template'
import { db } from '../storage/db'

export const useUserTemplatesStore = defineStore('user-templates', () => {
  const templates = ref<UserTemplate[]>([])

  async function loadAll(): Promise<void> {
    templates.value = await db.templates.toArray()
  }

  return { templates, loadAll }
})
