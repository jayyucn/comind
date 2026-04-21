/**
 * Utility functions for calculating left values in tree structures
 */

/**
 * Calculate new left value for a new block
 * @param siblings Existing sibling blocks
 * @param insertAfterId Optional ID of block to insert after
 */
export function calculateNewLeft(
  siblings: Array<{ left: number; id?: string }>,
  insertAfterId?: string
): number {
  if (siblings.length === 0) {
    return 100 // Start with 100 for first node
  }

  // Sort siblings by left value
  const sortedSiblings = [...siblings].sort((a, b) => a.left - b.left)

  if (!insertAfterId) {
    // Insert at end
    const lastSibling = sortedSiblings[sortedSiblings.length - 1]
    return lastSibling.left + 100
  }

  // Insert after specific block
  const insertAfterIndex = sortedSiblings.findIndex(s => s.id === insertAfterId)
  if (insertAfterIndex === -1 || insertAfterIndex === sortedSiblings.length - 1) {
    // Insert at end if not found or already last
    const lastSibling = sortedSiblings[sortedSiblings.length - 1]
    return lastSibling.left + 100
  }

  const current = sortedSiblings[insertAfterIndex]
  const next = sortedSiblings[insertAfterIndex + 1]
  return current.left + (next.left - current.left) / 2
}

/**
 * Calculate left value for outdent operation
 * @param parent Parent block
 * @param siblings Siblings at new level
 */
export function calculateOutdentLeft(
  parent: { left: number },
  siblings: Array<{ left: number }>
): number {
  if (siblings.length === 0) {
    return parent.left + 100
  }

  // Find position after parent
  const sortedSiblings = [...siblings].sort((a, b) => a.left - b.left)
  
  // Find the first sibling with left > parent.left
  let insertionPoint = sortedSiblings.length
  for (let i = 0; i < sortedSiblings.length; i++) {
    if (sortedSiblings[i].left > parent.left) {
      insertionPoint = i
      break
    }
  }

  if (insertionPoint === 0) {
    return sortedSiblings[0].left - 50
  } else if (insertionPoint === sortedSiblings.length) {
    return sortedSiblings[sortedSiblings.length - 1].left + 100
  } else {
    const prev = sortedSiblings[insertionPoint - 1]
    const next = sortedSiblings[insertionPoint]
    return prev.left + (next.left - prev.left) / 2
  }
}

/**
 * Calculate left value for indent operation
 * @param parent Parent block
 * @param siblings Existing children
 */
export function calculateIndentLeft(
  parent: { left: number },
  siblings: Array<{ left: number }>
): number {
  if (siblings.length === 0) {
    return parent.left + 100
  }

  const sortedSiblings = [...siblings].sort((a, b) => a.left - b.left)
  const lastSibling = sortedSiblings[sortedSiblings.length - 1]
  return lastSibling.left + 100
}

/**
 * Reindex left values to fix gaps and ensure consistency
 * @param blocks Array of blocks to reindex
 */
export function reindexLeftValues(blocks: Array<{ id: string; parentId: string | null; left: number }>): Array<{ id: string; left: number }> {
  const parentMap = new Map<string | null, Array<{ id: string; left: number }>>()

  // Group blocks by parent
  for (const block of blocks) {
    const children = parentMap.get(block.parentId) || []
    children.push({ id: block.id, left: block.left })
    parentMap.set(block.parentId, children)
  }

  // Reindex each group
  const updates: Array<{ id: string; left: number }> = []
  
  for (const [_parentId, children] of parentMap) {
    // Sort by current left value
    const sortedChildren = [...children].sort((a, b) => a.left - b.left)
    
    // Assign new left values starting from 100 with 100 increments
    sortedChildren.forEach((child, index) => {
      updates.push({ id: child.id, left: 100 + (index * 100) })
    })
  }

  return updates
}

/**
 * Validate left values for consistency
 * @param blocks Array of blocks to validate
 */
export function validateLeftValues(blocks: Array<{ parentId: string | null; left: number }>): boolean {
  const parentMap = new Map<string | null, Set<number>>()

  for (const block of blocks) {
    const leftSet = parentMap.get(block.parentId) || new Set()
    if (leftSet.has(block.left)) {
      return false // Duplicate left value
    }
    leftSet.add(block.left)
    parentMap.set(block.parentId, leftSet)
  }

  return true
}