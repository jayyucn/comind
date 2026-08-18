import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, nextTick } from 'vue'

const status = ref<{ peers: Array<{ id: string }> }>({ peers: [] })
const editorStore = { showToast: vi.fn() }

vi.mock('../composables/useSyncStatus', () => ({ useSyncStatus: () => ({ status }) }))
vi.mock('../stores/editor', () => ({ useEditorStore: () => editorStore }))

import { useSyncPeerToast } from './useSyncPeerToast'

beforeEach(() => {
  status.value = { peers: [] }
  editorStore.showToast.mockClear()
})

describe('useSyncPeerToast', () => {
  it('peer 数增加 → 弹 toast', async () => {
    useSyncPeerToast()
    status.value = { peers: [{ id: 'a' }] }
    await nextTick()
    expect(editorStore.showToast).toHaveBeenCalledWith('Android 设备已连接', 'info')
  })

  it('peer 数减少 → 不弹 toast', async () => {
    useSyncPeerToast()
    status.value = { peers: [{ id: 'a' }] }
    await nextTick()
    editorStore.showToast.mockClear()
    status.value = { peers: [] }
    await nextTick()
    expect(editorStore.showToast).not.toHaveBeenCalled()
  })
})
