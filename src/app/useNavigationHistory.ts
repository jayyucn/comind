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

  // 以当前路由锚定首帧栈，避免深链/刷新时栈与真实历史错位（bug B 的轻量缓解）
  const historyStack = ref<HistoryItem[]>([{ path: route.fullPath || '' }])
  const historyIndex = ref(0)

  const canGoBack = computed(() => historyIndex.value > 0)
  const canGoForward = computed(() => historyIndex.value < historyStack.value.length - 1)

  watch(
    () => route.fullPath,
    (newPath) => {
      const stack = historyStack.value
      const idx = historyIndex.value

      // 1) 与当前栈顶一致：app 内 goBack/goForward 已先移动索引，路由回落到同一项
      if (stack[idx]?.path === newPath) return

      // 2) 浏览器原生前进/后退：索引未随 goBack/goForward 移动，路由落在相邻项 → 同步
      //    否则会被误判为“全新导航”而重复压栈，导致栈与真实历史分叉（bug C）
      if (idx > 0 && stack[idx - 1]?.path === newPath) {
        historyIndex.value = idx - 1
        return
      }
      if (idx < stack.length - 1 && stack[idx + 1]?.path === newPath) {
        historyIndex.value = idx + 1
        return
      }

      // 3) 全新导航：若当前不在栈尾，先截断后续历史（中段跳转丢弃“未来”分支）
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
    const currentItem = historyStack.value[historyIndex.value]
    // 当前索引之前被删条目数：数组前移时索引需同步回退，否则当前视图会前漂（bug A）
    const removedBefore =
      historyStack.value.slice(0, historyIndex.value + 1).filter((i) => i.pageId === pageId).length
    const newStack = historyStack.value.filter((item) => item.pageId !== pageId)

    if (newStack.length === 0) {
      historyStack.value = [{ path: route.fullPath || '' }]
      historyIndex.value = 0
      return
    }

    if (currentItem && currentItem.pageId === pageId) {
      // 当前项自身被删：钳到原位置，避免越界
      historyIndex.value = Math.min(historyIndex.value, newStack.length - 1)
    } else {
      // 当前项存活：因前面被删条目数回退索引，保持指向同一项
      historyIndex.value = Math.max(0, historyIndex.value - removedBefore)
    }
    historyStack.value = newStack
  }

  // 自注册回收回调（单槽；App 根生命周期内唯一消费者）
  pageStore.onRemovePageFromHistory(removePageFromHistory)

  return { historyIndex, canGoBack, canGoForward, goBack, goForward }
}
