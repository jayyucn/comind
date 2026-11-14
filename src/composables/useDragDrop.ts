/** 拖拽判定所需的最小矩形字段；DOMRect 结构性兼容，纯函数测试可传普通对象 */
export interface DragRect {
  left: number
  right: number
  top: number
  height: number
}

/**
 * 光标相对深度锚点（目标块 bullet 左缘）量化出的层级变化：
 * -1 提升一级 / 0 同级 / +1 降为子级。钳制在单级（一次拖拽只切一层）。
 *
 * 锚点两侧各半个刻度（step/2）构成同级宽列：垂直拖动时光标天然落在 bullet
 * 附近，恒判为同级；水平推过半刻度才切层级。取代旧的「行左右缘固定 px」
 * 热区 —— 旧热区垂直拖行时稍偏水平就会误触层级切换。
 */
export function computeDepthDelta(
  cursorX: number,
  anchorLeft: number,
  step: number
): -1 | 0 | 1 {
  const offset = cursorX - anchorLeft
  if (offset >= step / 2) return 1
  if (offset <= -step / 2) return -1
  return 0
}

/**
 * 纵向落位：光标落在目标块的上半 ⇒ before，下半 ⇒ after。
 *
 * 传进来的必须是**整块外框**，不能是 bullet 的矩形。bullet 钉在首行后，
 * 长块（16 行表格 500px）的 bullet 中线贴着顶部，用它判定等于把「插到前面」
 * 压缩成顶部一条缝。此前 bullet 垂直居中恰好让两者重合，属于巧合而非契约。
 */
export function computeSortPosition(cursorY: number, blockRect: DragRect): 'before' | 'after' {
  const centerY = blockRect.top + blockRect.height / 2
  return cursorY < centerY ? 'before' : 'after'
}
