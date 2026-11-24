// 看板横向滚动的纯计算件。
//
// 为什么单独抽出来：这几条判定都依赖「布局几何 + 滚动余量」，在 jsdom 里拿不到真实布局，
// 放进组件就只能在测试里堆 defineProperty 造假。抽成纯函数后，组件只负责取数、调用、落地。

/** 边缘自动滚的触边带宽度（px）。指针进入这个带就按比例加速。 */
export const EDGE_SCROLL_BAND = 60

/** 边缘自动滚的单帧最大位移（px/帧，60fps 下约 960px/s）。 */
export const EDGE_SCROLL_MAX = 16

/**
 * 拖拽时的边缘自动滚速度：正数向右、负数向左、0 = 不滚。
 *
 * 速度随「指针越过触边带内边界的比例」线性增长（贴边越快，越靠外越快），
 * 这样既能慢速微调、也能快速横穿整块看板。指针已移出容器时按满速处理
 * （用户意图明确：就是要往那个方向走）。
 */
export function edgeAutoScrollSpeed(
  pointerX: number,
  left: number,
  right: number,
  band: number = EDGE_SCROLL_BAND,
  max: number = EDGE_SCROLL_MAX,
): number {
  if (band <= 0 || max <= 0) return 0
  if (pointerX < left + band) {
    const ratio = Math.min(1, (left + band - pointerX) / band)
    return -Math.max(1, Math.round(ratio * max))
  }
  if (pointerX > right - band) {
    const ratio = Math.min(1, (pointerX - (right - band)) / band)
    return Math.max(1, Math.round(ratio * max))
  }
  return 0
}

/** 纵向容器在 deltaY 的方向上是否还有可消费的余量（滚到底就不该再吃掉滚轮）。 */
export function canConsumeVertical(
  el: { scrollTop: number; scrollHeight: number; clientHeight: number },
  deltaY: number,
  tol = 1,
): boolean {
  const max = el.scrollHeight - el.clientHeight
  if (max <= tol) return false
  if (deltaY > 0) return el.scrollTop < max - tol
  if (deltaY < 0) return el.scrollTop > tol
  return false
}

/**
 * 完全落在视口右侧之外的列数。
 *
 * 「完全不可见」= 列左边界已经越过容器右边界；被切掉半截的列不算 —— 用户看得见它，
 * 也拖得进去，把它算成「还有 1 列」会让人以为那一列根本看不到。
 */
export function countHiddenRight(
  cols: readonly { left: number }[],
  containerRight: number,
  tol = 1,
): number {
  return cols.filter((c) => c.left >= containerRight - tol).length
}

/** 翻页步长 = 一屏减一列（留一列作锚，避免翻完不知道自己在哪）。 */
export function pageStepOf(viewportWidth: number, columnWidth: number): number {
  return Math.max(columnWidth, viewportWidth - columnWidth)
}

/**
 * 该次 pointerdown 能否起手平移看板。
 *
 * 起手边界（每一条都有理由，不是保守起见）：
 * - 不可滚时一律不接管：没有可移动的内容，接管只会让点击多走一次判断；
 * - 只左键：中键/右键在容器上既不触发原生 autoscroll，也不该被赋予新语义；
 * - 触摸/触屏笔不接管：那里浏览器原生横滑本来就能滚，抢过来反而更差（实测容器
 *   `touch-action: auto`，指针事件与原生滚动会互相干扰）；
 * - `.board-card` 不接管：左键拖卡片是「改分组」，同一个手势不能有两种语义；
 * - `.column-header` 不接管：列的身份区，留给将来的列排序/重命名；
 * - 其余（列内空白、列间间隙、列下方大片背景）全部接管 —— 桌面鼠标在这些位置按住
 *   拖动本来不产生滚动，只会选中一片跨列文本（真机实测），接管没有剥夺任何能力。
 */
export function isPanStartAllowed(
  target: Element | null,
  opts: { button: number; pointerType: string; maxScroll: number },
): boolean {
  if (opts.maxScroll <= 1) return false
  if (opts.button !== 0) return false
  if (opts.pointerType === 'touch' || opts.pointerType === 'pen') return false
  if (!target) return false
  const closest = (sel: string) => typeof target.closest === 'function' && !!target.closest(sel)
  if (closest('.board-card') || closest('.column-header')) return false
  return true
}
