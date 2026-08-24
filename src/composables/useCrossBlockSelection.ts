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
import { usePropertyStore } from '../stores/property'
import { useBlockRelationshipCleanup } from './useBlockRelationshipCleanup'
import { sortByDocumentOrderIds } from '../utils/block-helpers'
import type { Block, BlockClipPayload, BlockClipboardPayload } from '../types/block'
import type { Property, PropertyType } from '../types/property'

import { COMIND_BLOCK_MIME } from '../services/external-paste-parse'
// 内部剪贴板格式 MIME 单一来源（ADR-0025 D5）；此处仅转发供既有导入方使用
export { COMIND_BLOCK_MIME }

export function useCrossBlockSelection() {
  const blockStore = useBlockStore()
  const relationshipCleanup = useBlockRelationshipCleanup()

  const dragStartBlockId = ref<string | null>(null)
  const isDragging = ref(false)
  /** 本次追踪是否起始于属性区（ADR-0035 D6）：属性区起点仅做块选区、不激活编辑器 */
  const trackingFromProperty = ref(false)
  const selectedIds = reactive(new Set<string>())
  const anchorIds = reactive(new Set<string>())

  function clearSelection() {
    anchorIds.clear()
    selectedIds.clear()
  }

  function clearTracking() {
    dragStartBlockId.value = null
    isDragging.value = false
    trackingFromProperty.value = false
    selectedIds.clear()
  }

  function startTracking(blockId: string, fromProperty = false) {
    if (anchorIds.size > 0) {
      clearSelection()
    }
    dragStartBlockId.value = blockId
    trackingFromProperty.value = fromProperty
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
    trackingFromProperty.value = false
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

  /**
   * 复制选中 block 为结构化剪贴板载荷（ADR-0025 D4/D5/D10/D11）。
   *
   * - 自定义 MIME（JSON 森林）+ text/plain 缩进文本兜底
   * - 完整子树（无视 collapsed）；仅遍历锚点及其后代，不再全页 DFS
   * - properties 随行：优先 propertyStore 实时缓存，回退 on-block 载入快照
   */
  async function copyToClipboard() {
    const forest = buildClipForest()
    const payload: BlockClipboardPayload = { version: 1, kind: 'blocks', blocks: forest }
    const text = forestToText(forest, 0, [])
    await writeClipboard(payload, text)
  }

  /** 森林顶层 = 文档序锚点中非「另一锚点后代」者；子树完整递归（D8/D10） */
  function buildClipForest(): BlockClipPayload[] {
    if (anchorIds.size === 0) return []

    const anchors = sortByDocumentOrderIds(anchorIds, blockStore.blocks)

    const isUnderAnchor = (block: Block): boolean => {
      let pid: string | null = block.parentId
      while (pid) {
        if (anchorIds.has(pid)) return true
        pid = blockStore.blocks.find(b => b.id === pid)?.parentId ?? null
      }
      return false
    }

    const roots = anchors
      .map(id => blockStore.blocks.find(b => b.id === id))
      .filter((b): b is Block => !!b && !isUnderAnchor(b))

    return roots.map(b => buildClipPayload(b))
  }

  function buildClipPayload(block: Block): BlockClipPayload {
    // 完整子树：无视 collapsed（D10 —— 折叠只是视图状态）
    const children = blockStore.getChildren(block.id).map(c => buildClipPayload(c))
    return {
      id: block.id,
      content: block.content,
      type: block.type,
      format: block.format ? { ...block.format } : null,
      properties: blockPropsRecord(block),
      children,
    }
  }

  /** 属性随行（D11）：propertyStore 实时缓存优先，回退页面载入时的 on-block 快照 */
  function blockPropsRecord(block: Block): Record<string, { value: string; type: string }> | null {
    const propertyStore = usePropertyStore()
    let props: Property[] = propertyStore.getBlockProperties(block.id)
    if (props.length === 0 && block.properties && block.properties.length > 0) {
      props = block.properties.map(p => ({
        id: p.id,
        blockId: p.block_id,
        key: p.key,
        value: p.value,
        type: p.type as PropertyType,
        sortOrder: p.sort_order,
        isHidden: p.is_hidden === 1,
        isDeleted: p.is_deleted === 1,
        schemaVersion: p.schema_version,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      }))
    }
    if (props.length === 0) return null
    const record: Record<string, { value: string; type: string }> = {}
    for (const p of props) {
      record[p.key] = {
        value: typeof p.value === 'string' ? p.value : JSON.stringify(p.value),
        type: p.type,
      }
    }
    return record
  }

  /** text/plain 兜底：人类可读的缩进文本（外部 App 粘贴可用） */
  function forestToText(nodes: BlockClipPayload[], depth: number, parts: string[]): string {
    for (const n of nodes) {
      parts.push('  '.repeat(depth) + n.content)
      forestToText(n.children, depth + 1, parts)
    }
    return parts.join('\n')
  }

  async function writeClipboard(payload: BlockClipboardPayload, text: string): Promise<void> {
    const json = JSON.stringify(payload)
    try {
      const item = new ClipboardItem({
        [COMIND_BLOCK_MIME]: new Blob([json], { type: COMIND_BLOCK_MIME }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })
      await navigator.clipboard.write([item])
      return
    } catch {
      // 降级 1：仅纯文本（内部粘贴不可用，外部可读）
      try {
        await navigator.clipboard.writeText(text)
        return
      } catch {
        // 降级 2：execCommand 兜底
      }
    }
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
  }

  async function deleteSelected() {
    if (anchorIds.size === 0) return
    const toDelete = [...anchorIds]

    // 先保存所有块的快照，在删除任何块之前！
    const blocksBeforeDelete = [...blockStore.blocks]

    // 按 pageId 分组被删块的 id
    const deletedByPage = new Map<string, string[]>()
    for (const id of toDelete) {
      const b = blocksBeforeDelete.find(x => x.id === id)
      if (b) {
        const existing = deletedByPage.get(b.pageId) || []
        existing.push(id)
        deletedByPage.set(b.pageId, existing)
      }
    }

    // 按页分别调用 cleanupAfterDelete，只传该页的被删块 id 和快照
    for (const [pageId, pageDeletedIds] of deletedByPage) {
      await relationshipCleanup.cleanupAfterDelete(pageId, pageDeletedIds, blocksBeforeDelete)
    }
  }

  return {
    dragStartBlockId,
    isDragging,
    trackingFromProperty,
    selectedIds,
    anchorIds,
    clearSelection,
    clearTracking,
    startTracking,
    computeRange,
    finalizeSelection,
    toggleBlock,
    isBlockSelected,
    copyToClipboard,
    deleteSelected
  }
}

export type CrossBlockSelection = ReturnType<typeof useCrossBlockSelection>