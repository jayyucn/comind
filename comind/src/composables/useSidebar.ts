// composables/useSidebar.ts
import { ref, computed } from 'vue'

const isCollapsed = ref(false)

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

  return {
    isCollapsed: computed(() => isCollapsed.value),
    toggle,
    collapse,
    expand,
  }
}