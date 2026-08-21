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

/** 向上查找最近的可滚动祖先（仅纵向、且确有纵向溢出才计入）。 */
function findScrollable(node: EventTarget | null): HTMLElement | null {
  let el = node as HTMLElement | null
  while (el && el !== document.body) {
    const cs = getComputedStyle(el)
    // 浮层只渲染纵向指示条，故只认「纵向可滚动 + 确有纵向溢出」的容器。
    // 仅横向溢出（如表宽超出视口）不画纵向指示条，避免误判。
    const verticalScrollable = /(auto|scroll|overlay)/.test(cs.overflowY)
    if (verticalScrollable && el.scrollHeight > el.clientHeight) {
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

/**
 * 立即隐藏浮层并清空活动容器（含未决的隐藏定时器）。
 * 容器被路由卸载 / KeepAlive 缓存隐藏后调用，避免浮层残影钉在旧位置。
 */
function hideOverlay(): void {
  if (hideTimer) {
    window.clearTimeout(hideTimer)
    hideTimer = null
  }
  activeEl = null
  if (overlay) {
    overlay.classList.remove('is-visible')
    overlay.classList.remove('is-dragging')
    overlay.style.pointerEvents = 'none'
  }
}

/** 浮层当前定位的容器是否仍实际渲染（未卸载、未 display:none 隐藏）。 */
function isActiveRendered(): boolean {
  return !!activeEl && activeEl.isConnected && activeEl.getClientRects().length > 0
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
    if (dragging) return
    if (overlay && !isActiveRendered()) {
      // 活动容器已被卸载或隐藏（如路由切换）：立即隐藏，不留残影。
      hideOverlay()
      return
    }
    if (overlay) {
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
    if (!isActiveRendered()) {
      // 拖拽期间活动容器被路由卸载/隐藏：终止拖拽并隐藏浮层。
      dragging = false
      ov.classList.remove('is-dragging')
      hideOverlay()
      return
    }
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
  // 同样走 findScrollable 校验纵向溢出，避免非溢出容器被误判。
  document.addEventListener(
    'scroll',
    (e: Event) => {
      if (activeEl && !isActiveRendered()) hideOverlay()
      const el = findScrollable(e.target)
      if (el) showFor(el)
    },
    true
  )

  // 鼠标移入可滚动容器即浮现；移出后由隐藏定时器淡出。
  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (activeEl && !isActiveRendered()) hideOverlay()
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
    if (activeEl && !isActiveRendered()) {
      hideOverlay()
    } else if (activeEl && overlay?.classList.contains('is-visible')) {
      updateGeometry(activeEl)
    }
  })

  // 主动兜底：任何 DOM 卸载（路由切换、KeepAlive 缓存、组件销毁）都会触发子节点
  // 变化，在微任务内立即收走浮层——不必等 hideTimer(300ms) 或下一次鼠标/滚动事件，
  // 消除「路由到新页面后短暂残留滚动条」。
  const observer = new MutationObserver(() => {
    if (activeEl && !isActiveRendered()) hideOverlay()
  })
  observer.observe(document.body, { childList: true, subtree: true })
}
