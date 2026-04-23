// composables/useRecent.ts
import { computed, ref } from 'vue'
import { usePageStore } from '../stores/pages'

export function useRecent() {
  const pageStore = usePageStore()
  const isExpanded = ref(false)

  // 按 Page.updatedAt 降序排列
  const recentPages = computed(() => {
    return [...pageStore.pages]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, isExpanded.value ? 10 : 3)
  })

  function toggleExpand() {
    isExpanded.value = !isExpanded.value
  }

  return {
    recentPages,
    isExpanded: computed(() => isExpanded.value),
    toggleExpand,
  }
}