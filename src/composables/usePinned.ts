// composables/usePinned.ts
import { computed, ref, watch } from 'vue'

import { usePageStore } from '../stores/pages'
import type { Page } from '../types/page'

const STORAGE_KEY = 'comind:pinned'
const COLLAPSE_KEY = 'comind:sidebar-pinned-collapsed'

// 全局状态（模块级单例）
const pinnedIds = ref<string[]>([])
const isExpanded = ref(true)

// 初始化：从 localStorage 加载折叠状态
if (typeof window !== 'undefined') {
  const stored = localStorage.getItem(COLLAPSE_KEY)
  if (stored === 'false') {
    isExpanded.value = false
  }
}

// 初始化：从 localStorage 加载置顶
if (typeof window !== 'undefined') {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    try {
      pinnedIds.value = JSON.parse(stored)
    } catch {
      pinnedIds.value = []
    }
  }
}

export function usePinned() {
  const pageStore = usePageStore()

  // 持久化：变化时写入
  watch(pinnedIds, (ids) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  }, { deep: true })

  // 持久化折叠状态
  watch(isExpanded, (val) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(COLLAPSE_KEY, String(val))
    }
  })

  // 置顶的 Page 列表（按置顶顺序）
  const pinnedPages = computed(() => {
    return pinnedIds.value
      .map(id => pageStore.getPage(id))
      .filter((page): page is Page => page !== undefined)
  })

  function isPinned(pageId: string): boolean {
    return pinnedIds.value.includes(pageId)
  }

  function addPin(pageId: string) {
    if (!pinnedIds.value.includes(pageId)) {
      pinnedIds.value.push(pageId)
    }
  }

  function removePin(pageId: string) {
    const index = pinnedIds.value.indexOf(pageId)
    if (index > -1) {
      pinnedIds.value.splice(index, 1)
    }
  }

  function togglePin(pageId: string) {
    if (isPinned(pageId)) {
      removePin(pageId)
    } else {
      addPin(pageId)
    }
  }

  function toggleExpand() {
    isExpanded.value = !isExpanded.value
  }

  return {
    pinnedPages,
    isPinned,
    addPin,
    removePin,
    togglePin,
    isExpanded: computed(() => isExpanded.value),
    toggleExpand,
  }
}
