export type DropAction = 'promote' | 'sort' | 'nest' | null

export interface DropTarget {
  action: DropAction
  toParentId: string | null
  beforeId: string | null
}

export interface UseDropTargetOptions {
  threshold: number
}

export function useDropTarget(options: UseDropTargetOptions = { threshold: 20 }) {
  const { threshold } = options

  function getDropTarget(
    targetBlockEl: HTMLElement,
    cursorX: number,
    getBlockById: (id: string) => { id: string; parentId: string | null } | undefined
  ): DropTarget {
    const bulletEl = targetBlockEl.querySelector('.block-bullet')
    if (!bulletEl) return { action: null, toParentId: null, beforeId: null }

    const bulletRect = bulletEl.getBoundingClientRect()
    const bulletCenterX = bulletRect.left + bulletRect.width / 2
    const relativeX = cursorX - bulletCenterX

    const blockId = targetBlockEl.dataset.blockId
    if (!blockId) return { action: null, toParentId: null, beforeId: null }

    const block = getBlockById(blockId)
    if (!block) return { action: null, toParentId: null, beforeId: null }

    if (Math.abs(relativeX) <= threshold) {
      return {
        action: 'sort',
        toParentId: block.parentId,
        beforeId: blockId
      }
    }

    if (relativeX > threshold) {
      return {
        action: 'nest',
        toParentId: blockId,
        beforeId: null
      }
    }

    let currentEl = targetBlockEl.parentElement?.closest('.block')
    while (currentEl) {
      const bullet = currentEl.querySelector('.block-bullet')
      if (bullet) {
        const rect = bullet.getBoundingClientRect()
        const centerX = rect.left + rect.width / 2
        if (cursorX <= centerX + threshold) {
          const currentId = currentEl.dataset.blockId
          const currentBlock = currentId ? getBlockById(currentId) : undefined
          if (currentBlock) {
            return {
              action: 'promote',
              toParentId: currentBlock.parentId,
              beforeId: currentId
            }
          }
        }
      }
      currentEl = currentEl.parentElement?.closest('.block')
    }

    return { action: null, toParentId: null, beforeId: null }
  }

  return { getDropTarget }
}
