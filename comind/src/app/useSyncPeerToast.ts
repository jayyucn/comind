import { ref, watch } from 'vue'
import { useSyncStatus } from '../composables/useSyncStatus'
import { useEditorStore } from '../stores/editor'

/**
 * 同步对端 toast：peer 数增加时弹出「Android 设备已连接」。
 * useSyncStatus 保持纯数据，UI 副作用收归此处。
 */
export function useSyncPeerToast() {
  const { status } = useSyncStatus()
  const editorStore = useEditorStore()
  const prevPeerCount = ref(0)

  watch(
    () => status.value?.peers.length,
    (newCount) => {
      if (newCount !== undefined && newCount > prevPeerCount.value) {
        editorStore.showToast('Android 设备已连接', 'info')
      }
      prevPeerCount.value = newCount ?? 0
    }
  )
}
