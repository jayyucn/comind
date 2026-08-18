import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useSidebar } from '../composables/useSidebar'

/**
 * 全局快捷键：ctrl+g/i/t 路由跳转，ctrl+b 切换侧栏，ctrl+k 经回调切换搜索面板。
 * onToggleSearch 由 App.vue 传入（搜索面板可见性是 App 本地 UI 状态，不带入本模块）。
 */
export function useGlobalHotkeys(opts: { onToggleSearch: () => void }) {
  const router = useRouter()
  const { toggle } = useSidebar()

  function handleKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault()
      opts.onToggleSearch()
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
      e.preventDefault()
      router.push('/graph')
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
      e.preventDefault()
      router.push('/ideas')
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault()
      toggle()
    } else if ((e.ctrlKey || e.metaKey) && e.key === 't') {
      e.preventDefault()
      router.push('/tasks')
    }
  }

  onMounted(() => document.addEventListener('keydown', handleKeydown))
  onUnmounted(() => document.removeEventListener('keydown', handleKeydown))
}
