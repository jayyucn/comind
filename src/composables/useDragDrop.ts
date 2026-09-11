export const DRAG_THRESHOLD = {
  LEFT: 15,
  RIGHT: 15
}

/** 拖拽判定所需的最小矩形字段；DOMRect 结构性兼容，纯函数测试可传普通对象 */
export interface DragRect {
  left: number
  right: number
  top: number
  height: number
}

export function computeDropZone(cursorX: number, bulletRect: DragRect): 'left' | 'center' | 'right' {
  if (cursorX <= bulletRect.left + DRAG_THRESHOLD.LEFT) return 'left'
  if (cursorX >= bulletRect.right - DRAG_THRESHOLD.RIGHT) return 'right'
  return 'center'
}

export function computeSortPosition(cursorY: number, bulletRect: DragRect): 'before' | 'after' {
  const bulletCenterY = bulletRect.top + bulletRect.height / 2
  return cursorY < bulletCenterY ? 'before' : 'after'
}
