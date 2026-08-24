// composables/useFavorites.ts
import { ref, computed, watch } from 'vue'
import { usePageStore } from '../stores/pages'

const STORAGE_KEY = 'comind:favorites'
const COLLAPSE_KEY = 'comind:sidebar-fav-collapsed'

// 全局状态（模块级单例）
const favoriteIds = ref<string[]>([])
const isExpanded = ref(true)

// 初始化：从 localStorage 加载折叠状态
if (typeof window !== 'undefined') {
  const stored = localStorage.getItem(COLLAPSE_KEY)
  if (stored === 'false') {
    isExpanded.value = false
  }
}

// 初始化：从 localStorage 加载收藏
if (typeof window !== 'undefined') {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    try {
      favoriteIds.value = JSON.parse(stored)
    } catch {
      favoriteIds.value = []
    }
  }
}

export function useFavorites() {
  const pageStore = usePageStore()

  // 持久化：变化时写入
  watch(favoriteIds, (ids) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  }, { deep: true })

  // 持久化折叠状态
  watch(isExpanded, (val) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(COLLAPSE_KEY, String(val))
    }
  })

  // 收藏的 Page 列表（按收藏顺序）
  const favoritePages = computed(() => {
    return favoriteIds.value
      .map(id => pageStore.getPage(id))
      .filter(Boolean) as any[]
  })

  function isFavorite(pageId: string): boolean {
    return favoriteIds.value.includes(pageId)
  }

  function addFavorite(pageId: string) {
    if (!favoriteIds.value.includes(pageId)) {
      favoriteIds.value.push(pageId)
    }
  }

  function removeFavorite(pageId: string) {
    const index = favoriteIds.value.indexOf(pageId)
    if (index > -1) {
      favoriteIds.value.splice(index, 1)
    }
  }

  function toggleFavorite(pageId: string) {
    if (isFavorite(pageId)) {
      removeFavorite(pageId)
    } else {
      addFavorite(pageId)
    }
  }

  function toggleExpand() {
    isExpanded.value = !isExpanded.value
  }

  return {
    favoritePages,
    isFavorite,
    addFavorite,
    removeFavorite,
    toggleFavorite,
    isExpanded: computed(() => isExpanded.value),
    toggleExpand,
  }
}
