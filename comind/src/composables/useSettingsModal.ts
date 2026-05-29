import { ref, computed } from 'vue'

const isOpen = ref(false)

export function useSettingsModal() {
  function open() {
    isOpen.value = true
  }

  function close() {
    isOpen.value = false
  }

  return {
    isOpen: computed(() => isOpen.value),
    open,
    close,
  }
}
