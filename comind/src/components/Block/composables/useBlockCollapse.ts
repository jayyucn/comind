import { ref, watch } from 'vue'
import type { Ref } from 'vue'
import { useBlockStore } from '../../../stores/blocks'
import type { TreeNode } from '../../../types/block'

const COLLAPSE_ANIMATION_DURATION = 220 // ms

/**
 * Block 折叠 composable
 *
 * 职责：
 * - 管理 collapsed 状态（初始化自 block.format.collapsed）
 * - toggleCollapse 切换状态并同步 store
 * - 控制折叠/展开动画时序（isAnimating 标志驱动 CSS 过渡）
 * - 计算 childrenHeight（供 <BlockChildren> 做动画，当前由 CSS 类驱动）
 */
export function useBlockCollapse(node: Ref<TreeNode>) {
  const blockStore = useBlockStore()

  const collapsed = ref(node.value.block?.format?.collapsed ?? false)
  const isAnimating = ref(false)
  const childrenHeight = ref(0)

  async function toggleCollapse() {
    if (node.value.children.length === 0 || isAnimating.value) return
    collapsed.value = !collapsed.value
  }

  watch(collapsed, async (isCollapsed) => {
    blockStore.updateBlockFormat(node.value.id, { collapsed: isCollapsed })

    if (node.value.children.length === 0) return

    isAnimating.value = true
    setTimeout(() => { isAnimating.value = false }, COLLAPSE_ANIMATION_DURATION)
  })

  async function updateChildrenHeight(childrenEl: HTMLElement | null) {
    if (!childrenEl) return
    const scrollH = childrenEl.scrollHeight
    childrenHeight.value = scrollH > 0 ? scrollH : await calcAllChildrenHeight(childrenEl)
  }

  async function calcAllChildrenHeight(childrenEl: HTMLElement): Promise<number> {
    let total = 0
    for (const childEl of childrenEl.children) {
      const rowEl = childEl.querySelector('.block-row') as HTMLElement | null
      if (rowEl) total += rowEl.offsetHeight
      const grandchildrenEl = childEl.querySelector('.block-children') as HTMLElement | null
      if (grandchildrenEl) {
        const bid = (childEl as HTMLElement).dataset.blockId
        const blk = blockStore.blocks.find(b => b.id === bid)
        if (blk?.format?.collapsed) {
          total += 1
        } else {
          const orig = grandchildrenEl.style.maxHeight
          grandchildrenEl.style.maxHeight = 'none'
          total += grandchildrenEl.scrollHeight
          grandchildrenEl.style.maxHeight = orig
        }
      }
    }
    return total
  }

  return {
    collapsed,
    isAnimating,
    childrenHeight,
    toggleCollapse,
    updateChildrenHeight,
    calcAllChildrenHeight
  }
}
