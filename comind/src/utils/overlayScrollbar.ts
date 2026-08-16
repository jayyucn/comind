// 全局浮层滚动条管理器（Overlay Scrollbar）
//
// 行为：隐藏原生滚动条后，用一个单例浮层指示条替代。它仅在「滚动」或「悬停于可滚动容器」
// 时浮现，停滞后自动淡出；可拖拽以滚动内容。通过事件委托（scroll 捕获 + mousemove）覆盖
// 应用内所有可滚动容器，无需逐个挂载——新增容器自动生效。
//
// 适用范围：Chromium 系（WebView2 / Chrome / Edge）。Firefox 由 CSS 降级为无可见滚动条。

const HIDE_DELAY = 300 // 停滞后淡出延迟（ms）
const MIN_THUMB = 24 // 指示条最小高度（px），避免过短难以点中

let overlay: HTMLElement | null = null
let activeEl: HTMLElement | null = null
let hideTimer: number | null = null
let dragging = false
let dragStartY = 0
let dragStartScrollTop = 0

/** 向上查找最近的可滚动祖先（需真实存在溢出内容）。 */
function findScrollable(node: EventTarget | null): HTMLElement | null {
  let el = node as HTMLElement | null
  while (el && el !== document.body) {
    const cs = getComputedStyle(el)
    const scrollable =
      /(auto|scroll|overlay)/.test(cs.overflowY) ||
      /(auto|scroll|overlay)/.test(cs.overflowX)
    if (scrollable && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)) {
      return el
    }
    el = el.parentElement
  }
  return null
}

/** 懒创建单例浮层指示条。 */
function ensureOverlay(): HTMLElement {
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.className = 'cm-overlay-scrollbar'
    document.body.appendChild(overlay)
    bindDrag(overlay)
  }
  return overlay
}

/** 按容器当前滚动位置计算并写入浮层几何（仅纵向）。 */
function updateGeometry(el: HTMLElement): void {
  const ov = ensureOverlay()
  const rect = el.getBoundingClientRect()
  const trackH = el.clientHeight
  const maxScroll = el.scrollHeight - el.clientHeight
  const thumbH = Math.max(MIN_THUMB, (trackH / el.scrollHeight) * trackH)
  const top = maxScroll > 0 ? (el.scrollTop / maxScroll) * (trackH - thumbH) : 0

  ov.style.height = `${thumbH}px`
  ov.style.left = `${rect.right - parseFloat(getSbSize()) - 2}px`
  ov.style.top = `${rect.top + top}px`
}

/** 读取 --scrollbar-size 令牌（默认 6px）。 */
function getSbSize(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--scrollbar-size')
  return v.trim() || '6px'
}

function scheduleHide(): void {
  if (hideTimer) window.clearTimeout(hideTimer)
  hideTimer = window.setTimeout(() => {
    if (!dragging && overlay) {
      overlay.classList.remove('is-visible')
      overlay.style.pointerEvents = 'none'
    }
  }, HIDE_DELAY)
}

/** 为某可滚动容器显示浮层（幂等）。 */
function showFor(el: HTMLElement): void {
  activeEl = el
  const ov = ensureOverlay()
  updateGeometry(el)
  ov.classList.add('is-visible')
  ov.style.pointerEvents = 'auto'
  scheduleHide()
}

function bindDrag(ov: HTMLElement): void {
  ov.addEventListener('pointerdown', (e: PointerEvent) => {
    if (!activeEl) return
    dragging = true
    dragStartY = e.clientY
    dragStartScrollTop = activeEl.scrollTop
    ov.classList.add('is-dragging')
    ov.setPointerCapture(e.pointerId)
    e.preventDefault()
  })

  ov.addEventListener('pointermove', (e: PointerEvent) => {
    if (!dragging || !activeEl) return
    const trackH = activeEl.clientHeight
    const thumbH = ov.offsetHeight
    const maxScroll = activeEl.scrollHeight - activeEl.clientHeight
    const ratio = (e.clientY - dragStartY) / Math.max(1, trackH - thumbH)
    activeEl.scrollTop = dragStartScrollTop + ratio * maxScroll
  })

  const end = (e: PointerEvent) => {
    if (!dragging) return
    dragging = false
    ov.classList.remove('is-dragging')
    try {
      ov.releasePointerCapture(e.pointerId)
    } catch {
      /* 指针已释放 */
    }
    scheduleHide()
  }
  ov.addEventListener('pointerup', end)
  ov.addEventListener('pointercancel', end)
}

/**
 * 初始化全局浮层滚动条。应在应用启动期调用一次（幂等）。
 * 返回当前活动容器，便于测试；正常运行无需使用。
 */
export function initOverlayScrollbars(): void {
  if ((window as any).__cm_overlay_scrollbar) return
  ;(window as any).__cm_overlay_scrollbar = true

  // scroll 不冒泡，用捕获阶段在 document 上统一截获任何元素的滚动。
  document.addEventListener(
    'scroll',
    (e: Event) => {
      const target = e.target
      if (!target || target === document || target === document.documentElement) return
      showFor(target as HTMLElement)
    },
    true
  )

  // 鼠标移入可滚动容器即浮现；移出后由隐藏定时器淡出。
  document.addEventListener('mousemove', (e: MouseEvent) => {
    const el = findScrollable(e.target)
    if (el) {
      if (el !== activeEl || !overlay?.classList.contains('is-visible')) showFor(el)
      else scheduleHide()
    } else if (!dragging) {
      scheduleHide()
    }
  })

  // 容器尺寸变化时重算几何（如窗口缩放、侧栏折叠）。
  window.addEventListener('resize', () => {
    if (activeEl && overlay?.classList.contains('is-visible')) updateGeometry(activeEl)
  })
}
