import { ref } from 'vue'

/**
 * 网页链接悬浮条（ADR-0067 D2）的全局状态。
 *
 * 两种宿主共用一条悬浮条：
 * - `chip`：text 块正文里的 markdown 外链 `[标题](url)`，菜单四项（编辑/移除/切视图/复制）；
 * - `block`：卡片 / 预览视图的 web-link 块，菜单两项（切视图/复制）。
 *
 * 定位由触发方传入视口坐标（chip 是 v-html 出来的裸 span，块是组件根元素）；
 * 状态放模块级 ref，使 BlockList 的事件委托与 WebLinkBlock 的 hover 都能驱动同一条。
 */
export interface WebLinkToolbarTarget {
  /** 宿主所在块 id */
  blockId: string
  /** chip | block */
  kind: 'chip' | 'block'
  /** 原始链接地址 */
  url: string
  /** chip 显示文字（标题视图的 alias / 链接视图的 url） */
  title: string
  /** 视口坐标（chip 或块根元素的左上角，悬浮条贴其上方） */
  left: number
  top: number
  /** 当前视图（判断「链接视图/标题视图」用；chip 宿主恒为 text 块） */
  view: 'link' | 'title' | 'card' | 'preview'
}

const target = ref<WebLinkToolbarTarget | null>(null)
let hideTimer: number | undefined

/**
 * 指针已进入悬浮条本身。置位期间宿主块/其它 chip 的 hover 不得改写目标，
 * 否则「悬浮条浮在别的 chip 上方」时点下拉会被它下面的 chip 抢走目标，
 * 菜单当场被重置 —— 视图切换点了没反应的表象之一。
 */
let pinned = false

/** 视图切换下拉的开合（悬浮条内部状态，独立导出供全局关闭） */
const viewMenuOpen = ref(false)

export function useWebLinkChipToolbar() {
  function show(next: WebLinkToolbarTarget): void {
    if (pinned) return
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = undefined
    }
    // 同一个宿主重复 hover（子元素冒泡）不该把已展开的下拉关掉
    const same = !!target.value
      && target.value.kind === next.kind
      && target.value.blockId === next.blockId
      && target.value.url === next.url
    target.value = next
    if (!same) viewMenuOpen.value = false
  }

  /** 指针进入 / 离开悬浮条：进入期间冻结目标，离开后交给正常的隐藏排队 */
  function setPinned(value: boolean): void {
    pinned = value
    if (value) {
      if (hideTimer) {
        clearTimeout(hideTimer)
        hideTimer = undefined
      }
    }
  }

  function scheduleHide(delay = 220): void {
    if (pinned) return
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = window.setTimeout(() => {
      target.value = null
      viewMenuOpen.value = false
    }, delay)
  }

  function hide(): void {
    if (hideTimer) clearTimeout(hideTimer)
    target.value = null
    viewMenuOpen.value = false
    pinned = false
  }

  /** 指针进入悬浮条本身：取消排队中的隐藏，让菜单可点 */
  function cancelHide(): void {
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = undefined
    }
  }

  function isFor(blockId: string): boolean {
    return target.value?.blockId === blockId
  }

  return { target, show, scheduleHide, hide, cancelHide, setPinned, isFor, viewMenuOpen }
}
