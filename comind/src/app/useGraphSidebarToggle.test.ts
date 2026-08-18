import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, reactive, nextTick } from 'vue'

const visible = ref(false)
const activePanelId = ref('')
const rightSidebar = {
  visible,
  activePanelId,
  setVisible: (v: boolean) => {
    visible.value = v
  },
  setActivePanel: (id: string) => {
    activePanelId.value = id
  },
}
const route = reactive<{ meta: Record<string, any> }>({ meta: {} })

vi.mock('../composables/useRightSidebar', () => ({ useRightSidebar: () => rightSidebar }))
vi.mock('vue-router', () => ({ useRoute: () => route }))

import { useGraphSidebarToggle } from './useGraphSidebarToggle'

beforeEach(() => {
  visible.value = false
  activePanelId.value = ''
  route.meta = {}
})

describe('useGraphSidebarToggle', () => {
  it('isGraphPanelOpen 计算', () => {
    const { isGraphPanelOpen } = useGraphSidebarToggle()
    expect(isGraphPanelOpen.value).toBe(false)
    visible.value = true
    activePanelId.value = 'graph'
    expect(isGraphPanelOpen.value).toBe(true)
  })

  it('handleToggle 三态', () => {
    const { handleToggle } = useGraphSidebarToggle()
    handleToggle() // 关 → 开图
    expect(visible.value).toBe(true)
    expect(activePanelId.value).toBe('graph')
    handleToggle() // 已在图 → 收起
    expect(visible.value).toBe(false)
  })

  it('route.meta.hideRightSidebarToggle → 收起', async () => {
    useGraphSidebarToggle()
    visible.value = true
    route.meta = { hideRightSidebarToggle: true }
    await nextTick()
    expect(visible.value).toBe(false)
  })
})
