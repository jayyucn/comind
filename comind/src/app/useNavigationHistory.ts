import { ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { usePageStore } from '../stores/pages'

export type HistoryItem = {
  path: string
  pageId?: string
}

/**
 * 导航历史栈：自维护 route watch + 栈截断/前进后退，对外只暴露窄接口。
 * 保留 window.history.go(±1) 耦合（行为与原 App.vue 一致）。
 */
export function useNavigationHistory() {
  const route = useRoute()
  const pageStore = usePageStore()

  const historyStack = ref<HistoryItem[]>([{ path: '' }])
  const historyIndex = ref(0)

  const canGoBack = computed(() => historyIndex.value > 0)
  const canGoForward = computed(() => historyIndex.value < historyStack.value.length - 1)

  watch(
    () => route.fullPath,
    async (newPath) => {
      if (newPath === historyStack.value[historyIndex.value]?.path) return

      // 若当前不在栈尾，先截断后续历史
      if (historyIndex.value < historyStack.value.length - 1) {
        historyStack.value = historyStack.value.slice(0, historyIndex.value + 1)
      }

      // 尝试获取当前页面 ID
      let pageId: string | undefined
      if (route.params.pageId || route.params.date) {
        const idOrTitle = (route.params.pageId || route.params.date) as string
        const page = pageStore.getPage(idOrTitle) ?? pageStore.getPageByTitle(idOrTitle)
        if (page) {
          pageId = page.id
        }
      }

      historyStack.value.push({ path: newPath, pageId })
      historyIndex.value = historyStack.value.length - 1
    }
  )

  function goBack() {
    if (!canGoBack.value) return
    historyIndex.value--
    window.history.go(-1)
  }

  function goForward() {
    if (!canGoForward.value) return
    historyIndex.value++
    window.history.go(1)
  }

  function removePageFromHistory(pageId: string) {
    const newStack = historyStack.value.filter((item) => item.pageId !== pageId)

    if (historyIndex.value >= newStack.length) {
      historyIndex.value = Math.max(0, newStack.length - 1)
    }

    if (newStack.length === 0) {
      historyStack.value = [{ path: '' }]
      historyIndex.value = 0
    } else {
      historyStack.value = newStack
    }
  }

  // 自注册回收回调（单槽；App 根生命周期内唯一消费者）
  pageStore.onRemovePageFromHistory(removePageFromHistory)

  return { canGoBack, canGoForward, goBack, goForward }
}
