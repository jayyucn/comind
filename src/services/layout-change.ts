/**
 * 内容区布局变更广播 —— 「缓存视口矩形」失效的统一信号。
 *
 * ## 为什么需要它
 * 折叠侧栏（ctrl+b）、开合右侧栏、拖 pane 分隔条，改的都只是**内容容器的宽度**：
 * 浏览器不会派发 `window resize`，滚动容器也可能一动不动（scrollTop 不变）。
 * 而所有把视口矩形缓存下来的东西——fixed 覆盖层（文本选区高亮、撤销落点闪烁）、
 * 以 `getBoundingClientRect()` 定位的浮层（BasePopover 锚点模式）——都只会在
 * `scroll` / `window resize` 时重测，于是**停在旧坐标**：
 * - 文本选区高亮整段错位（侧栏折叠后正文横向移动、换行重排，色带留在原处）；
 * - 表格范围工具条不跟手（锚点格跟着走了 173px，工具条一格不动）。
 *
 * ## 口径
 * - **只由布局壳的 owner（App.vue）发**：它持有 `.content-body`，也知道 pane 分隔条的拖拽。
 *   消费方（BlockList / BasePopover / TableBlock）只在挂载期订阅，不自己观察容器。
 * - **不去抖**：拖分隔条时需要逐帧跟随。
 * - 订阅方必须是**幂等重测**（同一个 tick 内被调多次也只重算一遍几何，不产生副作用）。
 * - 依赖方向：services 层不认识任何组件，只有「订阅 / 广播 / 观察」三个纯 DOM 动作。
 */
type LayoutChangeHandler = () => void

const handlers = new Set<LayoutChangeHandler>()

/** 订阅布局变更，返回退订函数（组件卸载时必须调用）。 */
export function onLayoutChange(handler: LayoutChangeHandler): () => void {
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}

/**
 * 广播一次布局变更。
 * 遍历副本：订阅方可能在回调里退订或重新订阅（浮层关闭时拆监听、菜单打开时挂监听）。
 */
export function emitLayoutChange(): void {
  for (const handler of [...handlers]) handler()
}

/**
 * 观察布局根：盒子尺寸**真的变了**才广播。
 * 同尺寸回调（RO 首帧、内容重排但容器盒子没变）直接吞掉，避免无意义重测。
 * 返回停止观察函数；无 ResizeObserver 的环境（jsdom / 老 WebView）退化为 noop。
 */
export function observeLayoutRoot(el: HTMLElement | null): () => void {
  if (!el || typeof ResizeObserver === 'undefined') return () => {}
  let lastWidth = -1
  let lastHeight = -1
  const observer = new ResizeObserver(() => {
    const width = el.clientWidth
    const height = el.clientHeight
    if (width === lastWidth && height === lastHeight) return
    lastWidth = width
    lastHeight = height
    emitLayoutChange()
  })
  observer.observe(el)
  return () => observer.disconnect()
}
