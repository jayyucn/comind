/**
 * 跨 Block 选择状态管理
 *
 * 选区按 ADR-0035 D2 建模为判别联合：任意时刻至多是 Block Selection 与 Text Range 之一。
 * 互斥由唯一写入口 transition() 拥有——转移即「整体替换目标态」，不存在「进这一态时
 * 记得清另一态」的散落清理，新增手势也无从漏清。
 *
 * 状态机（内部表示）：
 * - `{ kind: 'none' }`                              无选区
 * - `{ kind: 'block', ids, phase: 'tracking' }`      块选区拖拽中（对外视图 selectedIds）
 * - `{ kind: 'block', ids, phase: 'committed' }`     块选区已固化（对外视图 anchorIds）
 * - `{ kind: 'text', range }`                        跨块文本选区（对外视图 textRange）
 *
 * 手势临时量（dragStartBlockId / isDragging / trackingFromProperty / textDrag*）不参与
 * 选区互斥，单独保存；isDragging 由外部消费者（BlockList）在 mousemove 中设置。
 */
import { computed, ref } from 'vue'
import { useBlockStore } from '../stores/blocks'
import { usePropertyStore } from '../stores/property'
import { useBlockRelationshipCleanup } from './useBlockRelationshipCleanup'
import { sortByDocumentOrderIds } from '../utils/block-helpers'
import type { Block } from '../types/block'
import type { Property, PropertyType } from '../types/property'

import { COMIND_BLOCK_MIME, serializeBlocks, writeClipboardPayload } from '../services/block-clipboard'
// 内部剪贴板格式 MIME 单一来源（ADR-0025 D5）；此处仅转发供既有导入方使用
export { COMIND_BLOCK_MIME }
import { textRangeToText } from '../services/text-range'
import type { BlockOffset, TextRange } from '../services/text-range'

/** 选区状态（判别联合）：块选区与文本选区互斥由此结构保证 */
type SelectionState =
  | { kind: 'none' }
  | { kind: 'block'; ids: Set<string>; phase: 'tracking' | 'committed' }
  | { kind: 'text'; range: TextRange }

/**
 * 块 id 视图：只读部分保持 Set 习惯（size / has / 迭代），写方法只留消费方实际用到的
 * add / clear，且一律转投 transition()——外部直接写也不会绕过互斥。
 */
export interface SelectionIdView extends Iterable<string> {
  readonly size: number
  has(id: string): boolean
  add(id: string): void
  clear(): void
}

/** 空集合常量：非块态或相位不符时视图统一读它（idsOf 先读 state.value，依赖仍可追踪） */
const NO_IDS: ReadonlySet<string> = new Set()

export function useCrossBlockSelection() {
  const blockStore = useBlockStore()
  const relationshipCleanup = useBlockRelationshipCleanup()

  /** 选区权威（唯一真相） */
  const state = ref<SelectionState>({ kind: 'none' })

  const dragStartBlockId = ref<string | null>(null)
  const isDragging = ref(false)
  /** 本次追踪是否起始于属性区（ADR-0035 D6）：属性区起点仅做块选区、不激活编辑器 */
  const trackingFromProperty = ref(false)
  /** 文本选区拖拽状态（ADR-0035 D1）：内容区起点 */
  const textDragAnchor = ref<BlockOffset | null>(null)
  /** 文本拖拽起始屏幕坐标（用于与单击区分的最小位移阈值） */
  const textDragStartPoint = ref<{ x: number; y: number } | null>(null)
  const isTextDragging = ref(false)

  /** 唯一写入口：进入块态即无文本选区，进入文本态即无块选区；空块选区归一为「无选区」 */
  function transition(next: SelectionState) {
    state.value = next.kind === 'block' && next.ids.size === 0 ? { kind: 'none' } : next
  }

  function idsOf(phase: 'tracking' | 'committed'): ReadonlySet<string> {
    const s = state.value
    return s.kind === 'block' && s.phase === phase ? s.ids : NO_IDS
  }

  function idView(phase: 'tracking' | 'committed'): SelectionIdView {
    const read = () => idsOf(phase)
    const write = (ids: Set<string>) => transition({ kind: 'block', ids, phase })
    return {
      get size() {
        return read().size
      },
      has: (id: string) => read().has(id),
      add(id: string) {
        write(new Set(read()).add(id))
      },
      clear() {
        if (read().size > 0) write(new Set())
      },
      [Symbol.iterator]: () => read()[Symbol.iterator](),
    }
  }

  /** 拖拽中的块选区（BlockList 在 mousemove 中实时写入） */
  const selectedIds = idView('tracking')
  /** 已固化块选区：复制/删除等操作的作用对象 */
  const anchorIds = idView('committed')
  /** 已固化文本选区（只读视图） */
  const textRange = computed<TextRange | null>(() => {
    const s = state.value
    return s.kind === 'text' ? s.range : null
  })

  function clearSelection() {
    transition({ kind: 'none' })
  }

  function clearTracking() {
    dragStartBlockId.value = null
    isDragging.value = false
    trackingFromProperty.value = false
    // 仅中断「拖拽中」的块选区；已固化选区与文本选区不受清追踪影响
    const s = state.value
    if (s.kind === 'block' && s.phase === 'tracking') transition({ kind: 'none' })
  }

  function startTracking(blockId: string, fromProperty = false) {
    // 块选区手势开始：清掉已固化选区与文本选区（此刻尚未产生选区，故归一为「无选区」）
    transition({ kind: 'block', ids: new Set(), phase: 'tracking' })
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
    // 固化 = 拖拽中的块选区就地转为已固化块选区；非块态则固化为空（顺带清掉文本选区）
    transition({ kind: 'block', ids: new Set(idsOf('tracking')), phase: 'committed' })
    isDragging.value = false
    dragStartBlockId.value = null
    trackingFromProperty.value = false
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

    const ids = new Set(idsOf('committed'))

    if (ids.has(blockId)) {
      for (const id of toToggle) {
        ids.delete(id)
      }
    } else {
      for (const id of toToggle) {
        ids.add(id)
      }
    }
    // Ctrl+Click 切换即固化块选区（文本选区随之失效）
    transition({ kind: 'block', ids, phase: 'committed' })
  }

  /**
   * Ctrl+A 全选页面所有 Block（含后代子树），固化到块选区。
   * excludeRootId：页面根 Block 不参与渲染/选区（与 buildTree 一致）。
   */
  function selectAll(pageId: string, excludeRootId: string | null = null) {
    // 中断进行中的拖拽/文本拖拽态，避免随后的 mouseup finalizeSelection 用空选区覆盖新选区
    clearTracking()
    clearTextTracking()
    const ids = new Set<string>()
    for (const block of blockStore.getBlocksByPage(pageId)) {
      if (block.id === excludeRootId) continue
      ids.add(block.id)
    }
    transition({ kind: 'block', ids, phase: 'committed' })
  }

  function isBlockSelected(blockId: string): boolean {
    // 已固化看 anchorIds、未固化看 selectedIds —— 互斥保证同一时刻只有一个非空，故看当前块选区即可
    const s = state.value
    return s.kind === 'block' && s.ids.has(blockId)
  }

  // ── 文本选区（ADR-0035 D1/D3）──

  /** 内容区 mousedown 开始文本拖拽：记录锚点，清旧选区（文本+块） */
  function startTextTracking(anchor: BlockOffset, startPoint: { x: number; y: number }) {
    // 拖拽尚未产生选区：整体替换为「无选区」即清掉块选区与旧文本选区（互斥）
    transition({ kind: 'none' })
    textDragAnchor.value = anchor
    textDragStartPoint.value = startPoint
    isTextDragging.value = false
  }

  /** 拖拽中更新头部，实时设置文本选区 */
  function updateTextDrag(head: BlockOffset) {
    if (!textDragAnchor.value) return
    isTextDragging.value = true
    transition({ kind: 'text', range: { anchor: textDragAnchor.value, head } })
  }

  /** mouseup 固化文本选区：保留 textRange，清拖拽态 */
  function finalizeTextDrag() {
    isTextDragging.value = false
    textDragAnchor.value = null
    textDragStartPoint.value = null
  }

  /** 单击（未拖）时清拖拽态，不产生选区 */
  function clearTextTracking() {
    textDragAnchor.value = null
    textDragStartPoint.value = null
    isTextDragging.value = false
  }

  /** 仅清文本选区（块选区不受影响） */
  function clearTextSelection() {
    if (state.value.kind === 'text') transition({ kind: 'none' })
  }

  /** 复制文本选区：内容切片拼接（委托纯模块 textRangeToText） */
  async function copyTextToClipboard(pageId: string) {
    if (!textRange.value) return
    const text = textRangeToText(blockStore.getBlocksByPage(pageId), textRange.value)
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // 降级：execCommand 兜底
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

  /**
   * 复制选中 block 为结构化剪贴板载荷（ADR-0025 D4/D5/D10/D11）。
   *
   * 选区侧只负责「块选区 → 文档序顶层根」；载荷序列化（完整子树 + properties 随行）
   * 与落盘（自定义 MIME + text/plain 兜底降级链）委托 block-clipboard 模块。
   */
  async function copyToClipboard() {
    const payload = serializeBlocks(resolveClipRoots(), {
      resolveChildren: block => blockStore.getChildren(block.id),
      resolveProperties: blockPropsRecord,
    })
    await writeClipboardPayload(payload)
  }

  /** 森林顶层 = 文档序锚点中非「另一锚点后代」者；子树完整递归（D8/D10） */
  function resolveClipRoots(): Block[] {
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

    return anchors
      .map(id => blockStore.blocks.find(b => b.id === id))
      .filter((b): b is Block => !!b && !isUnderAnchor(b))
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
    textDragAnchor,
    textDragStartPoint,
    isTextDragging,
    textRange,
    clearSelection,
    clearTracking,
    startTracking,
    computeRange,
    finalizeSelection,
    toggleBlock,
    selectAll,
    isBlockSelected,
    copyToClipboard,
    deleteSelected,
    startTextTracking,
    updateTextDrag,
    finalizeTextDrag,
    clearTextTracking,
    clearTextSelection,
    copyTextToClipboard
  }
}

export type CrossBlockSelection = ReturnType<typeof useCrossBlockSelection>