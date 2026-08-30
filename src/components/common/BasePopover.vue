<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

/** 通用弹层原语（ADR-0009 D8，避让扩展见 ADR-0038）。
 *
 * 封装现有多个弹层重复的样板：Teleport to body + fixed overlay（点击空白关闭）
 * + 面板 @click.stop（阻止冒泡关闭）+ Escape 关闭 + 定位 + fade 过渡。
 * 所有新弹层（筛选/排序/分组芯片、字段选择菜单等）包一层它，不再各自重复。
 *
 * 定位有两种模式（ADR-0038）：
 * - 锚点模式（推荐）：传 `anchorEl` + `placement`，组件自测锚点盒子并按首选侧定位，
 *   空间不足自动翻到对侧、仍放不下再贴视口边；打开期间监听 scroll/resize 实时跟随。
 * - 遗留点模式：`position:{x,y}`，仅做视口收边，行为保持与 ADR-0009 完全一致。
 *
 * 样式复用项目令牌：--bg-base / --border / --radius-md / --shadow-modal / --transition-base。
 */
const props = withDefaults(
  defineProps<{
    /** 是否显示弹层。 */
    visible: boolean
    /** 面板锚点（来自触发元素 getBoundingClientRect 的 x/y）。ADR-0038 起为兜底模式，优先用 anchorEl。 */
    position?: { x: number; y: number }
    /** 点击 overlay 空白是否关闭，默认 true。 */
    closeOnOverlay?: boolean
    /** 锚点元素或返回元素的 getter；提供后进入锚点避让模式（ADR-0038）。
     *  不传（默认 null）则退化为遗留点模式，仅按 position 做视口收边（与 ADR-0009 一致）。 */
    anchorEl?: HTMLElement | (() => HTMLElement | null) | null
    /** 首选放置侧，默认 'bottom'；空间不足时自动翻到对侧。仅 anchorEl 模式生效。 */
    placement?: 'bottom' | 'top' | 'left' | 'right'
  }>(),
  {
    closeOnOverlay: true,
    placement: 'bottom',
    anchorEl: null,
  },
)

const emit = defineEmits<{
  /** 用户通过 overlay 点击 / Escape 请求关闭。 */
  close: []
}>()

const panelEl = ref<HTMLElement | null>(null)
const panelW = ref(0)
const panelH = ref(0)
// 内容真实尺寸（不受 maxHeight 限制影响），用于高度/宽度裁剪决策，避免 ResizeObserver 抖动循环。
const panelScrollH = ref(0)
const panelScrollW = ref(0)
const EDGE_MARGIN = 8
/** 锚点模式下面板与锚点之间的间隙（与旧调用方手写的 bottom+4 观感一致）。 */
const ANCHOR_GAP = 4

const anchorRect = ref<DOMRect | null>(null)

let resizeObserver: ResizeObserver | null = null
let scrollTargets: Array<Window | HTMLElement> = []
let onScroll: (() => void) | null = null

function measure() {
  const el = panelEl.value
  if (!el) return
  panelW.value = el.offsetWidth
  panelH.value = el.offsetHeight
  panelScrollH.value = el.scrollHeight
  panelScrollW.value = el.scrollWidth
}

function disconnectRO() {
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
}

// 内容异步加载（如通知列表）会改变弹层实际尺寸。仅按初次展开的尺寸收边，
// 内容变宽后会溢出视口被裁切。用 ResizeObserver 持续同步测量，保证收边始终生效。
function observe() {
  const el = panelEl.value
  if (!el) return
  measure()
  if (typeof ResizeObserver !== 'undefined') {
    disconnectRO()
    resizeObserver = new ResizeObserver(() => measure())
    resizeObserver.observe(el)
  }
}

function resolveAnchorEl(): HTMLElement | null {
  const a = props.anchorEl
  if (!a) return null
  const el = typeof a === 'function' ? a() : a
  return el ?? null
}

function updateAnchorRect() {
  const el = resolveAnchorEl()
  anchorRect.value = el ? el.getBoundingClientRect() : null
}

/** 向上查找最近的滚动祖先（overflow 含 auto/scroll/hidden 且确有溢出），用于实时重定位。 */
function getNearestScrollableAncestor(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement
  while (node && node !== document.documentElement && node !== document.body) {
    const style = getComputedStyle(node)
    const scrollableY =
      /(auto|scroll|hidden)/.test(style.overflowY) && node.scrollHeight > node.clientHeight
    const scrollableX =
      /(auto|scroll|hidden)/.test(style.overflowX) && node.scrollWidth > node.clientWidth
    if (scrollableY || scrollableX) return node
    node = node.parentElement
  }
  return null
}

function attachListeners() {
  if (onScroll) return
  onScroll = () => updateAnchorRect()
  scrollTargets = [window]
  const el = resolveAnchorEl()
  if (el) {
    const sc = getNearestScrollableAncestor(el)
    if (sc) scrollTargets.push(sc)
  }
  scrollTargets.forEach((t) => t.addEventListener('scroll', onScroll!, true))
  window.addEventListener('resize', onScroll)
}

function detachListeners() {
  if (!onScroll) return
  scrollTargets.forEach((t) => t.removeEventListener('scroll', onScroll!, true))
  window.removeEventListener('resize', onScroll)
  scrollTargets = []
  onScroll = null
}

// 显示/锚点/方位变化后（重新）测量面板、同步锚点盒子、挂接 ResizeObserver 与 scroll/resize 监听；
// 关闭时拆除监听与测量，避免泄漏（ADR-0038 实时重定位）。
watch(
  () => [props.visible, props.position, props.anchorEl, props.placement],
  () => {
    if (props.visible) {
      nextTick(() => {
        observe()
        updateAnchorRect()
        attachListeners()
      })
    } else {
      disconnectRO()
      detachListeners()
    }
  },
  { deep: true, immediate: true },
)

const FLIP: Record<'bottom' | 'top' | 'left' | 'right', 'bottom' | 'top' | 'left' | 'right'> = {
  bottom: 'top',
  top: 'bottom',
  left: 'right',
  right: 'left',
}

/** 仅当调用方提供锚点或点时才以内联 fixed 定位面板；否则交回 CSS。
 *  锚点模式（ADR-0038）：首选侧起点对齐 → 空间不足自动翻对侧 → 仍放不下贴视口边。
 *  遗留点模式：仅按测量尺寸做视口收边，行为保持与 ADR-0009 完全一致。 */
const panelStyle = computed(() => {
  const vw = typeof window !== 'undefined' ? window.innerWidth : Number.MAX_SAFE_INTEGER
  const vh = typeof window !== 'undefined' ? window.innerHeight : Number.MAX_SAFE_INTEGER

  // —— 锚点避让模式（ADR-0038）——
  // 首选侧 → 翻对侧 → 若两侧都放不下（面板比两侧可用空间都高/宽），
  // 选空间更大的一侧，并把面板尺寸裁到该侧可用空间内，确保绝不遮住锚点。
  const rect = anchorRect.value
  if (rect) {
    const pw = panelW.value
    const ph = panelH.value
    // 用 scrollHeight/Width 反映内容真实尺寸（不受 maxHeight 裁剪影响），裁剪决策据此得出、稳定不抖动。
    const naturalH = panelScrollH.value || ph
    const naturalW = panelScrollW.value || pw
    const place = (s: 'bottom' | 'top' | 'left' | 'right') => {
      if (s === 'bottom') return { left: rect.left, top: rect.bottom + ANCHOR_GAP }
      if (s === 'top') return { left: rect.left, top: rect.top - ph - ANCHOR_GAP }
      if (s === 'right') return { left: rect.right + ANCHOR_GAP, top: rect.top }
      return { left: rect.left - pw - ANCHOR_GAP, top: rect.top } // left
    }
    // 某侧是否「在视口内且不与锚点重叠」
    const fits = (s: 'bottom' | 'top' | 'left' | 'right', w: number, h: number) => {
      const p = place(s)
      const inView =
        p.left >= EDGE_MARGIN &&
        p.top >= EDGE_MARGIN &&
        p.left + w <= vw - EDGE_MARGIN &&
        p.top + h <= vh - EDGE_MARGIN
      const noOverlap =
        p.left + w <= rect.left ||
        p.left >= rect.right ||
        p.top + h <= rect.top ||
        p.top >= rect.bottom
      return inView && noOverlap
    }
    const order: Array<'bottom' | 'top' | 'left' | 'right'> = [
      props.placement,
      FLIP[props.placement],
    ]
    let chosen = order.find((s) => fits(s, naturalW, naturalH))

    let effW = naturalW
    let effH = naturalH
    if (!chosen) {
      // 两侧都放不下：取空间更大的一侧，并把面板尺寸限制在可用空间内（不遮锚点为前提）
      const freeOf = (s: 'bottom' | 'top' | 'left' | 'right') => {
        const room =
          s === 'top' || s === 'bottom'
            ? s === 'top'
              ? rect.top
              : vh - rect.bottom
            : s === 'left'
              ? rect.left
              : vw - rect.right
        return room - ANCHOR_GAP - EDGE_MARGIN
      }
      chosen = freeOf(order[0]) >= freeOf(order[1]) ? order[0] : order[1]
      if (chosen === 'top' || chosen === 'bottom') {
        effH = Math.max(0, Math.min(naturalH, freeOf(chosen)))
      } else {
        effW = Math.max(0, Math.min(naturalW, freeOf(chosen)))
      }
    }

    const p = place(chosen)
    const left = effW
      ? Math.min(Math.max(p.left, EDGE_MARGIN), vw - effW - EDGE_MARGIN)
      : p.left
    const top = effH
      ? Math.min(Math.max(p.top, EDGE_MARGIN), vh - effH - EDGE_MARGIN)
      : p.top
    const style: Record<string, string> = { left: `${left}px`, top: `${top}px` }
    if (effH > 0 && effH < naturalH) style.maxHeight = `${effH}px`
    if (effW > 0 && effW < naturalW) style.maxWidth = `${effW}px`
    return style
  }

  // —— 遗留点模式（与 ADR-0009 完全一致）——
  if (!props.position) return undefined
  const rawX = props.position.x
  const rawY = props.position.y
  // 收边：弹层右/下溢出视口时反向贴边，至少留 EDGE_MARGIN
  const x = panelW.value
    ? Math.min(rawX, Math.max(EDGE_MARGIN, vw - panelW.value - EDGE_MARGIN))
    : rawX
  const y = panelH.value
    ? Math.min(rawY, Math.max(EDGE_MARGIN, vh - panelH.value - EDGE_MARGIN))
    : rawY
  return { left: `${x}px`, top: `${y}px` }
})

function onOverlayClick() {
  if (props.closeOnOverlay) emit('close')
}

function onKeyDown(e: KeyboardEvent) {
  if (props.visible && e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  }
}

onMounted(() => document.addEventListener('keydown', onKeyDown, true))
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeyDown, true)
  disconnectRO()
  detachListeners()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="base-popover-fade">
      <div
        v-if="visible"
        class="base-popover-overlay"
        data-testid="base-popover-overlay"
        @click.self="onOverlayClick"
      >
        <div
          class="base-popover"
          ref="panelEl"
          role="dialog"
          data-testid="base-popover"
          :style="panelStyle"
          @click.stop
        >
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.base-popover-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-popover);
}

.base-popover {
  position: fixed;
  z-index: calc(var(--z-popover) + 1);
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-modal);
  font-family: inherit;
  max-width: 90vw;
  max-height: 80vh;
  overflow: auto;
}

.base-popover-fade-enter-active,
.base-popover-fade-leave-active {
  transition: opacity var(--transition-base), transform var(--transition-base);
}

.base-popover-fade-enter-from,
.base-popover-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
