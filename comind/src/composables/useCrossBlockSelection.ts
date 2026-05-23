import { reactive, ref } from 'vue'
import { useBlockStore } from '../stores/blocks'

export function useCrossBlockSelection() {
  const blockStore = useBlockStore()

  const dragStartBlockId = ref<string | null>(null)
  const isDragging = ref(false)
  const selectedIds = reactive(new Set<string>())
  const anchorIds = reactive(new Set<string>())

  function clearSelection() {
    anchorIds.clear()
    selectedIds.clear()
  }

  function clearTracking() {
    dragStartBlockId.value = null
    isDragging.value = false
    selectedIds.clear()
  }

  function startTracking(blockId: string) {
    if (anchorIds.size > 0) {
      clearSelection()
    }
    dragStartBlockId.value = blockId
  }

  function computeRange(targetBlockId: string, pageId: string): Set<string> {
    const startId = dragStartBlockId.value
    if (!startId) return new Set()

    const result = new Set<string>()
    const visited = new Set<string>()

    function addDescendants(id: string) {
      if (visited.has(id)) return
      const block = blockStore.blocks.find(b => b.id === id)
      if (!block || block.pageId !== pageId) return
      visited.add(id)
      result.add(id)
      for (const child of blockStore.getChildren(id)) {
        addDescendants(child.id)
      }
    }

    if (startId === targetBlockId) {
      addDescendants(startId)
      return result
    }

    let current = startId
    let foundForward = false

    while (current) {
      if (current === targetBlockId) {
        foundForward = true
        break
      }
      const next = blockStore.findNextBlockInTreeOrder(current)
      if (!next) break
      current = next.id
    }

    const [fromId, toId] = foundForward
      ? [startId, targetBlockId]
      : [targetBlockId, startId]

    current = fromId
    while (current) {
      addDescendants(current)
      if (current === toId) break
      const next = blockStore.findNextBlockInTreeOrder(current)
      if (!next) break
      current = next.id
    }

    return result
  }

  function finalizeSelection() {
    anchorIds.clear()
    for (const id of selectedIds) {
      anchorIds.add(id)
    }
    isDragging.value = false
    dragStartBlockId.value = null
    selectedIds.clear()
  }

  function toggleBlock(blockId: string, pageId: string) {
    const toToggle = new Set<string>()
    const visited = new Set<string>()

    function collect(id: string) {
      if (visited.has(id)) return
      const block = blockStore.blocks.find(b => b.id === id)
      if (!block || block.pageId !== pageId) return
      visited.add(id)
      toToggle.add(id)
      for (const child of blockStore.getChildren(id)) {
        collect(child.id)
      }
    }
    collect(blockId)

    const isSelected = anchorIds.has(blockId)

    if (isSelected) {
      for (const id of toToggle) {
        anchorIds.delete(id)
      }
    } else {
      for (const id of toToggle) {
        anchorIds.add(id)
      }
    }
  }

  function isBlockSelected(blockId: string): boolean {
    return anchorIds.size > 0
      ? anchorIds.has(blockId)
      : selectedIds.has(blockId)
  }

  async function copyToClipboard() {
    const parts: string[] = []
    const visited = new Set<string>()

    function collect(blockId: string) {
      if (visited.has(blockId)) return
      const block = blockStore.blocks.find(b => b.id === blockId)
      if (!block) return
      visited.add(blockId)

      if (!anchorIds.has(blockId)) return

      parts.push(block.content)

      if (block.format?.collapsed) return

      for (const child of blockStore.getChildren(blockId)) {
        collect(child.id)
      }
    }

    for (const block of blockStore.sortedBlocks) {
      collect(block.id)
    }

    const text = parts.join('\n')
    await navigator.clipboard.writeText(text)
  }

  return {
    dragStartBlockId,
    isDragging,
    selectedIds,
    anchorIds,
    clearSelection,
    clearTracking,
    startTracking,
    computeRange,
    finalizeSelection,
    toggleBlock,
    isBlockSelected,
    copyToClipboard
  }
}

export type CrossBlockSelection = ReturnType<typeof useCrossBlockSelection>