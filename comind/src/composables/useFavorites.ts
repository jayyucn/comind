// composables/useFavorites.ts
import { ref, computed, watch, onMounted } from 'vue'
import { usePageStore } from '../stores/pages'

const STORAGE_KEY = 'comind:favorites'

// 全局状态（模块级单例）
const favoriteIds = ref<string[]>([])

export function useFavorites() {
  const pageStore = usePageStore()

  // 初始化：从 LocalStorage 加载
  onMounted(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      try {
        favoriteIds.value = JSON.parse(stored)
      } catch {
        favoriteIds.value = []
      }
    }
  })

  // 持久化：变化时写入
  watch(favoriteIds, (ids) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  }, { deep: true })

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

  return {
    favoritePages,
    isFavorite,
    addFavorite,
    removeFavorite,
    toggleFavorite,
  }
}