// composables/useSidebar.ts
import { ref, computed, watch } from 'vue'

const STORAGE_KEY = 'comind:sidebar-collapsed'
const isCollapsed = ref(false)

// 初始化：从 localStorage 加载
if (typeof window !== 'undefined') {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'true') {
    isCollapsed.value = true
  }
}

export function useSidebar() {
  function toggle() {
    isCollapsed.value = !isCollapsed.value
  }

  function collapse() {
    isCollapsed.value = true
  }

  function expand() {
    isCollapsed.value = false
  }

  // 持久化
  watch(isCollapsed, (val) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, String(val))
    }
  })

  return {
    isCollapsed: computed(() => isCollapsed.value),
    toggle,
    collapse,
    expand,
  }
}
