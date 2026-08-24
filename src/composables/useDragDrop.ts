export const DRAG_THRESHOLD = {
  LEFT: 15,
  RIGHT: 15
}

export function computeDropZone(cursorX: number, bulletRect: DOMRect): 'left' | 'center' | 'right' {
  if (cursorX <= bulletRect.left + DRAG_THRESHOLD.LEFT) return 'left'
  if (cursorX >= bulletRect.right - DRAG_THRESHOLD.RIGHT) return 'right'
  return 'center'
}

export function computeSortPosition(cursorY: number, bulletRect: DOMRect): 'before' | 'after' {
  const bulletCenterY = bulletRect.top + bulletRect.height / 2
  return cursorY < bulletCenterY ? 'before' : 'after'
}
