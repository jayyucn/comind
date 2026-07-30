// composables/useRecent.ts
import { computed, ref, watch } from 'vue'
import { usePageStore } from '../stores/pages'

const STORAGE_KEY = 'comind:sidebar-recent-collapsed'
const isExpanded = ref(true)

// 初始化：从 localStorage 加载
if (typeof window !== 'undefined') {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'false') {
    isExpanded.value = false
  }
}

export function useRecent() {
  const pageStore = usePageStore()

  // 按 Page.updatedAt 降序排列，最多 5 条
  const recentPages = computed(() => {
    return [...pageStore.pages]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5)
  })

  function toggleExpand() {
    isExpanded.value = !isExpanded.value
  }

  // 持久化
  watch(isExpanded, (val) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, String(val))
    }
  })

  return {
    recentPages,
    isExpanded: computed(() => isExpanded.value),
    toggleExpand,
  }
}
