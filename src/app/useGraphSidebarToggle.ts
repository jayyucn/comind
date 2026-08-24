import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useRightSidebar } from '../composables/useRightSidebar'

/**
 * 右侧栏图谱开关：三态切换 + 跟随 route.meta.hideRightSidebarToggle 自动收起。
 */
export function useGraphSidebarToggle() {
  const rightSidebar = useRightSidebar()
  const route = useRoute()

  const isGraphPanelOpen = computed(
    () => rightSidebar.visible.value && rightSidebar.activePanelId.value === 'graph'
  )

  function handleToggle() {
    if (!rightSidebar.visible.value) {
      rightSidebar.setVisible(true)
      rightSidebar.setActivePanel('graph')
    } else if (rightSidebar.activePanelId.value !== 'graph') {
      rightSidebar.setActivePanel('graph')
    } else {
      rightSidebar.setVisible(false)
    }
  }

  watch(
    () => route.meta.hideRightSidebarToggle,
    (hide) => {
      if (hide) {
        rightSidebar.setVisible(false)
      }
    }
  )

  return { isGraphPanelOpen, handleToggle }
}
