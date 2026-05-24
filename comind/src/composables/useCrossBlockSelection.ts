/**
 * 跨 Block 选择状态管理
 *
 * 管理拖拽选区（selectedIds）和固化选区（anchorIds）双重状态。
 * - selectedIds: 拖拽过程中的实时选区
 * - anchorIds: mouseup 后固化的最终选区，用于复制等操作
 * - isDragging: 由外部消费者（BlockList）在 mousemove 中设置
 */
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
    let walkCount = 0
    const MAX_WALK = blockStore.blocks.length * 2

    while (current && walkCount < MAX_WALK) {
      walkCount++
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
    walkCount = 0
    while (current && walkCount < MAX_WALK) {
      walkCount++
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

  async function copyToClipboard(pageId?: string) {
    const parts: string[] = []
    const visited = new Set<string>()

    function collect(blockId: string, depth: number) {
      if (visited.has(blockId)) return
      const block = blockStore.blocks.find(b => b.id === blockId)
      if (!block) return
      // 如果提供了 pageId，只处理该页面的块
      if (pageId && block.pageId !== pageId) return
      visited.add(blockId)

      if (anchorIds.has(blockId)) {
        const indent = '  '.repeat(depth)
        parts.push(indent + block.content)
      }

      if (block.format?.collapsed) return

      for (const child of blockStore.getChildren(blockId)) {
        collect(child.id, depth + 1)
      }
    }

    // 获取所有根块（如果提供了 pageId，只获取该页面的根块）
    const roots = blockStore.sortedBlocks.filter(b => !b.parentId && (!pageId || b.pageId === pageId))
    for (const root of roots) {
      collect(root.id, 0)
    }

    const text = parts.join('\n')
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
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