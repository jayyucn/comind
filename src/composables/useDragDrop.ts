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

export function computeSortPosition(cursorY: number, bulletRect: DragRect): 'before' | 'after' {
  const bulletCenterY = bulletRect.top + bulletRect.height / 2
  return cursorY < bulletCenterY ? 'before' : 'after'
}
