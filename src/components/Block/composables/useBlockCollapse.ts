import { computed, ref, toValue, watch } from 'vue'
import type { MaybeRefOrGetter, Ref } from 'vue'
import { useBlockStore } from '../../../stores/blocks'
import type { TreeNode } from '../../../types/block'

// 必须与折叠过渡时长保持一致（--dur-base，src/styles/tokens/_primitives.scss 的 $dur-base）：
// 动画期间 `is-animating` 既是 chevron 的防重入闸门，也是 `.block-children` 上
// `display: none`（折叠 = 布局移除，ADR-0045 D1）的时序闸门。取小了会把折叠动画的
// 尾巴削掉（提前 display:none）。
const COLLAPSE_ANIMATION_DURATION = 200 // ms

/**
 * Block 折叠 composable
 *
 * 职责：
 * - 读写持久化折叠标志（唯一权威 = block.format.collapsed，直连 store，不做本地副本）
 * - toggleCollapse 切换状态（写 store）
 * - 控制折叠/展开动画时序（isAnimating 标志驱动 CSS 过渡，同时是 display:none 的闸门）
 * - 计算 childrenHeight（供子节点容器做动画；当前折叠动画由 CSS 类驱动）
 *
 * **折叠范围**（ADR-0045 扩展）：折叠 = 隐藏本块的一切可折叠细节 —— 子树
 * （`.block-children`）**、字段带**（`.block-properties`：list 字段区 + book-note 来源行）
 * **与子任务进度条**（`.block-child-task-progress`）。
 * 因此「能不能折叠」有两路来源：有子块，或有字段行。字段行数由调用方从
 * `useBlockFieldRows().fields.length` 传入（与渲染同一份集合，守卫不会与屏幕漂移；
 * 不能用 `tags.length` 代理——标签有字段 ≠ 有可渲染行）。
 */
export function useBlockCollapse(node: Ref<TreeNode>, fieldRowCount?: MaybeRefOrGetter<number>) {
  const blockStore = useBlockStore()

  // 持久化折叠标志（唯一权威 = block.format.collapsed，ADR-0045 ①）。
  // 读写都直连 store，**不留本地副本**：真机实测过「store 侧改了标志、容器类名与 display 纹丝不动」
  // —— 本地副本是单向同步（本地→store），于是 reconcileCollapse 的复位（删除掏空 / 落入展开）
  // 写进 store 也到不了屏幕。派生读取同时消掉了这份第二真相。
  const collapsedFlag = computed({
    get: () => node.value.block?.format?.collapsed === true,
    set: (isCollapsed: boolean) => {
      void blockStore.updateBlockFormat(node.value.id, { collapsed: isCollapsed })
    },
  })
  const isAnimating = ref(false)
  const childrenHeight = ref(0)

  /** 字段区行数（未传 = 无可折叠字段）。 */
  const fieldRows = computed(() => toValue(fieldRowCount) ?? 0)

  /**
   * 折叠守卫（唯一判据，读取/写入/动画三处共用）：有子块 **或** 有字段行才谈得上折叠。
   * 与 tag 无关——只问「有没有可折叠的东西」。
   */
  const canCollapse = computed(() => node.value.children.length > 0 || fieldRows.value > 0)

  // 折叠是否生效 —— 读取侧唯一判定（ADR-0045 D2）：无可折叠内容 ⇒ 不折叠。
  // 既无子块又无字段行 + collapsed=true 是历史残留（子块被删除掏空后留下的 stale 标志，
  // 或字段被删光），兜底使其呈现为展开态，而不是让 UI 撒一个"这里有东西被藏起来了"的谎。
  const collapsed = computed(() => collapsedFlag.value && canCollapse.value)

  async function toggleCollapse() {
    if (!canCollapse.value || isAnimating.value) return
    collapsedFlag.value = !collapsedFlag.value
  }

  // 折叠/展开动画时序：store 写入改由上面的 setter 承担，这里只驱动 isAnimating。
  // 监听 persisted 标志（而非 collapsed），这样 store 侧的对账也能带动动画。
  watch(collapsedFlag, () => {
    if (!canCollapse.value) return

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
    canCollapse,
    isAnimating,
    childrenHeight,
    toggleCollapse,
    updateChildrenHeight,
    calcAllChildrenHeight
  }
}
