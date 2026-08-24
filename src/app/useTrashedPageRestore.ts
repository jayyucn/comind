import { ref, watch } from 'vue'
import { useBlockStore } from '../stores/blocks'
import { usePageStore } from '../stores/pages'

/**
 * 回收站恢复对话框：监听 blockStore.trashedPageWarnings，暴露可见性与确认/取消。
 */
export function useTrashedPageRestore() {
  const blockStore = useBlockStore()
  const pageStore = usePageStore()

  const visible = ref(false)
  const pageTitle = ref<string | null>(null)

  watch(
    () => blockStore.trashedPageWarnings,
    (warnings) => {
      if (warnings && warnings.length > 0) {
        pageTitle.value = warnings[0]
        visible.value = true
      }
    }
  )

  async function confirm() {
    if (pageTitle.value) {
      const trashedPage = pageStore.pages.find(
        (p) => p.title === pageTitle.value && p.deleted
      )
      if (trashedPage) {
        await pageStore.restorePage(trashedPage.id)
      }
    }
    visible.value = false
    blockStore.clearTrashedPageWarnings()
  }

  function cancel() {
    visible.value = false
    blockStore.clearTrashedPageWarnings()
  }

  return { visible, pageTitle, confirm, cancel }
}
