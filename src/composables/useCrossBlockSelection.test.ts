import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBlockStore } from '../stores/blocks'
import { usePropertyStore } from '../stores/property'
import { useCrossBlockSelection, COMIND_BLOCK_MIME } from './useCrossBlockSelection'

vi.mock('../storage/indexedDB', () => ({
  storage: {
    saveBlock: vi.fn(),
    deleteBlock: vi.fn(),
    deleteBlockCascade: vi.fn(),
    updateBlock: vi.fn(),
    getBlockTree: vi.fn().mockResolvedValue([]),
    createPageWithRootBlock: vi.fn().mockImplementation(async (title: string, type: 'normal' | 'ideas' = 'normal') => ({
      id: `page-${title}-${Math.random().toString(36).slice(2)}`,
      title,
      type,
      icon: null,
      blockId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isTrashed: false,
      trashedAt: null
    })),
    updatePage: vi.fn()
  }
}))

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('useCrossBlockSelection', () => {
  let blockStore: ReturnType<typeof useBlockStore>

  beforeEach(() => {
    blockStore = useBlockStore()
  })

  describe('clearSelection', () => {
    test('清除选区应清空 anchorIds 和 selectedIds', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const block1 = await blockStore.createBlock({ pageId, content: 'Block 1' })
      const block2 = await blockStore.createBlock({ pageId, content: 'Block 2' })

      selection.startTracking(block1.id)
      selection.selectedIds.add(block1.id)
      selection.selectedIds.add(block2.id)

      selection.clearSelection()

      expect(selection.anchorIds.size).toBe(0)
      expect(selection.selectedIds.size).toBe(0)
    })
  })

  describe('clearTracking', () => {
    test('清除追踪应重置拖拽状态', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const block = await blockStore.createBlock({ pageId, content: 'Block' })

      selection.startTracking(block.id)
      selection.isDragging.value = true
      selection.selectedIds.add(block.id)

      selection.clearTracking()

      expect(selection.dragStartBlockId.value).toBeNull()
      expect(selection.isDragging.value).toBe(false)
      expect(selection.selectedIds.size).toBe(0)
    })
  })

  describe('startTracking', () => {
    test('开始追踪应设置起始块ID', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const block = await blockStore.createBlock({ pageId, content: 'Block' })

      selection.startTracking(block.id)

      expect(selection.dragStartBlockId.value).toBe(block.id)
    })

    test('已有 anchorIds 时开始追踪应先清除选区', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const block1 = await blockStore.createBlock({ pageId, content: 'Block 1' })
      const block2 = await blockStore.createBlock({ pageId, content: 'Block 2' })

      selection.anchorIds.add(block1.id)

      selection.startTracking(block2.id)

      expect(selection.anchorIds.size).toBe(0)
      expect(selection.dragStartBlockId.value).toBe(block2.id)
    })
  })

  describe('trackingFromProperty', () => {
    test('startTracking 默认 fromProperty=false', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'
      const block = await blockStore.createBlock({ pageId, content: 'Block' })

      selection.startTracking(block.id)

      expect(selection.trackingFromProperty.value).toBe(false)
    })

    test('startTracking(blockId, true) 标记属性区起点', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'
      const block = await blockStore.createBlock({ pageId, content: 'Block' })

      selection.startTracking(block.id, true)

      expect(selection.trackingFromProperty.value).toBe(true)
    })

    test('clearTracking 重置 trackingFromProperty', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'
      const block = await blockStore.createBlock({ pageId, content: 'Block' })

      selection.startTracking(block.id, true)
      selection.clearTracking()

      expect(selection.trackingFromProperty.value).toBe(false)
    })

    test('finalizeSelection 重置 trackingFromProperty', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'
      const block = await blockStore.createBlock({ pageId, content: 'Block' })

      selection.startTracking(block.id, true)
      selection.selectedIds.add(block.id)
      selection.isDragging.value = true
      selection.finalizeSelection()

      expect(selection.trackingFromProperty.value).toBe(false)
    })
  })

  describe('文本选区（text selection）', () => {
    test('startTextTracking 记录锚点与起点', async () => {
      const selection = useCrossBlockSelection()
      const anchor = { blockId: 'a', offset: 3 }

      selection.startTextTracking(anchor, { x: 10, y: 20 })

      expect(selection.textDragAnchor.value).toEqual(anchor)
      expect(selection.textDragStartPoint.value).toEqual({ x: 10, y: 20 })
      expect(selection.isTextDragging.value).toBe(false)
    })

    test('updateTextDrag 设置 textRange 并标记拖拽', async () => {
      const selection = useCrossBlockSelection()
      selection.startTextTracking({ blockId: 'a', offset: 1 }, { x: 0, y: 0 })

      selection.updateTextDrag({ blockId: 'c', offset: 2 })

      expect(selection.isTextDragging.value).toBe(true)
      expect(selection.textRange.value).toEqual({
        anchor: { blockId: 'a', offset: 1 },
        head: { blockId: 'c', offset: 2 },
      })
    })

    test('finalizeTextDrag 清拖拽态但保留 textRange', async () => {
      const selection = useCrossBlockSelection()
      selection.startTextTracking({ blockId: 'a', offset: 1 }, { x: 0, y: 0 })
      selection.updateTextDrag({ blockId: 'c', offset: 2 })

      selection.finalizeTextDrag()

      expect(selection.isTextDragging.value).toBe(false)
      expect(selection.textDragAnchor.value).toBeNull()
      expect(selection.textRange.value).not.toBeNull()
    })

    test('clearTextSelection 清空 textRange', async () => {
      const selection = useCrossBlockSelection()
      selection.startTextTracking({ blockId: 'a', offset: 1 }, { x: 0, y: 0 })
      selection.updateTextDrag({ blockId: 'c', offset: 2 })

      selection.clearTextSelection()

      expect(selection.textRange.value).toBeNull()
    })

    test('块选区手势（toggleBlock）清文本选区（互斥）', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'
      const block = await blockStore.createBlock({ pageId, content: 'Block' })

      selection.startTextTracking({ blockId: block.id, offset: 1 }, { x: 0, y: 0 })
      selection.updateTextDrag({ blockId: block.id, offset: 2 })
      expect(selection.textRange.value).not.toBeNull()

      selection.toggleBlock(block.id, pageId)

      expect(selection.textRange.value).toBeNull()
    })

    test('开始新文本拖拽会清旧文本选区', async () => {
      const selection = useCrossBlockSelection()
      selection.startTextTracking({ blockId: 'a', offset: 1 }, { x: 0, y: 0 })
      selection.updateTextDrag({ blockId: 'c', offset: 2 })
      expect(selection.textRange.value).not.toBeNull()

      selection.startTextTracking({ blockId: 'b', offset: 0 }, { x: 5, y: 5 })

      expect(selection.textRange.value).toBeNull()
      expect(selection.textDragAnchor.value).toEqual({ blockId: 'b', offset: 0 })
    })
  })

  describe('computeRange', () => {
    test('无起始块ID时返回空集合', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const block = await blockStore.createBlock({ pageId, content: 'Block' })

      const range = selection.computeRange(block.id, pageId)

      expect(range.size).toBe(0)
    })

    test('起始块和目标块相同时返回该块及其子块', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const parent = await blockStore.createBlock({ pageId, content: 'Parent' })
      await blockStore.createBlock({ pageId, content: 'Child', parentId: parent.id })

      selection.startTracking(parent.id)

      const range = selection.computeRange(parent.id, pageId)

      expect(range.has(parent.id)).toBe(true)
      expect(range.size).toBe(2)
    })

    test('计算连续块的范围应包含所有块及其子块', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const block1 = await blockStore.createBlock({ pageId, content: 'Block 1' })
      const block2 = await blockStore.createBlock({ pageId, content: 'Block 2' })
      const childOfBlock1 = await blockStore.createBlock({ pageId, content: 'Child of Block 1', parentId: block1.id })
      const block3 = await blockStore.createBlock({ pageId, content: 'Block 3' })

      selection.startTracking(block1.id)

      const range = selection.computeRange(block2.id, pageId)

      expect(range.has(block1.id)).toBe(true)
      expect(range.has(block2.id)).toBe(true)
      expect(range.has(childOfBlock1.id)).toBe(true)
      expect(range.has(block3.id)).toBe(false)
    })

    test('跨层级选择应包含所有后代节点', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const grandparent = await blockStore.createBlock({ pageId, content: 'Grandparent' })
      const parent = await blockStore.createBlock({ pageId, content: 'Parent', parentId: grandparent.id })
      const child = await blockStore.createBlock({ pageId, content: 'Child', parentId: parent.id })
      const sibling = await blockStore.createBlock({ pageId, content: 'Sibling' })

      selection.startTracking(grandparent.id)

      const range = selection.computeRange(sibling.id, pageId)

      expect(range.has(grandparent.id)).toBe(true)
      expect(range.has(parent.id)).toBe(true)
      expect(range.has(child.id)).toBe(true)
      expect(range.has(sibling.id)).toBe(true)
    })

    test('不应包含不同页面的块', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const block1 = await blockStore.createBlock({ pageId, content: 'Block 1' })
      await blockStore.createBlock({ pageId: 'page-2', content: 'Other Page Block' })
      const block2 = await blockStore.createBlock({ pageId, content: 'Block 2' })

      selection.startTracking(block1.id)

      const range = selection.computeRange(block2.id, pageId)

      expect(range.size).toBeGreaterThan(0)
      for (const id of range) {
        const block = blockStore.blocks.find(b => b.id === id)
        expect(block?.pageId).toBe(pageId)
      }
    })
  })

  describe('finalizeSelection', () => {
    test('固化选区应将 selectedIds 复制到 anchorIds', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const block1 = await blockStore.createBlock({ pageId, content: 'Block 1' })
      const block2 = await blockStore.createBlock({ pageId, content: 'Block 2' })

      selection.startTracking(block1.id)
      selection.selectedIds.add(block1.id)
      selection.selectedIds.add(block2.id)

      selection.finalizeSelection()

      expect(selection.anchorIds.size).toBe(2)
      expect(selection.anchorIds.has(block1.id)).toBe(true)
      expect(selection.anchorIds.has(block2.id)).toBe(true)
    })

    test('固化选区应清除拖拽状态', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const block = await blockStore.createBlock({ pageId, content: 'Block' })

      selection.startTracking(block.id)
      selection.isDragging.value = true
      selection.selectedIds.add(block.id)

      selection.finalizeSelection()

      expect(selection.isDragging.value).toBe(false)
      expect(selection.dragStartBlockId.value).toBeNull()
      expect(selection.selectedIds.size).toBe(0)
    })
  })

  describe('toggleBlock', () => {
    test('未选中的块应被选中', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const block = await blockStore.createBlock({ pageId, content: 'Block' })

      selection.toggleBlock(block.id, pageId)

      expect(selection.anchorIds.has(block.id)).toBe(true)
    })

    test('已选中的块应被取消选中', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const block = await blockStore.createBlock({ pageId, content: 'Block' })
      const child = await blockStore.createBlock({ pageId, content: 'Child', parentId: block.id })

      selection.anchorIds.add(block.id)
      selection.anchorIds.add(child.id)

      selection.toggleBlock(block.id, pageId)

      expect(selection.anchorIds.has(block.id)).toBe(false)
      expect(selection.anchorIds.has(child.id)).toBe(false)
    })

    test('切换父块应同时切换所有子块', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const parent = await blockStore.createBlock({ pageId, content: 'Parent' })
      const child1 = await blockStore.createBlock({ pageId, content: 'Child 1', parentId: parent.id })
      const child2 = await blockStore.createBlock({ pageId, content: 'Child 2', parentId: parent.id })

      selection.toggleBlock(parent.id, pageId)

      expect(selection.anchorIds.has(parent.id)).toBe(true)
      expect(selection.anchorIds.has(child1.id)).toBe(true)
      expect(selection.anchorIds.has(child2.id)).toBe(true)
    })

    test('切换孙块应只切换该分支，不影响同级节点', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const grandparent = await blockStore.createBlock({ pageId, content: 'Grandparent' })
      const parent = await blockStore.createBlock({ pageId, content: 'Parent', parentId: grandparent.id })
      const child = await blockStore.createBlock({ pageId, content: 'Child', parentId: parent.id })
      const otherChild = await blockStore.createBlock({ pageId, content: 'Other Child', parentId: grandparent.id })

      selection.anchorIds.add(grandparent.id)
      selection.anchorIds.add(otherChild.id)

      selection.toggleBlock(child.id, pageId)

      expect(selection.anchorIds.has(grandparent.id)).toBe(true)
      expect(selection.anchorIds.has(child.id)).toBe(true)
      expect(selection.anchorIds.has(otherChild.id)).toBe(true)
    })
  })

  describe('isBlockSelected', () => {
    test('当 anchorIds 为空时应检查 selectedIds', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const block = await blockStore.createBlock({ pageId, content: 'Block' })

      selection.selectedIds.add(block.id)

      expect(selection.isBlockSelected(block.id)).toBe(true)
    })

    test('当 anchorIds 非空时应检查 anchorIds', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const block1 = await blockStore.createBlock({ pageId, content: 'Block 1' })
      const block2 = await blockStore.createBlock({ pageId, content: 'Block 2' })

      selection.anchorIds.add(block1.id)
      selection.selectedIds.add(block2.id)

      expect(selection.isBlockSelected(block1.id)).toBe(true)
      expect(selection.isBlockSelected(block2.id)).toBe(false)
    })

    test('未选中任何块时应返回 false', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const block = await blockStore.createBlock({ pageId, content: 'Block' })

      expect(selection.isBlockSelected(block.id)).toBe(false)
    })
  })

  describe('copyToClipboard（ADR-0025 结构化载荷）', () => {
    let writeMock: ReturnType<typeof vi.fn>
    let writeTextMock: ReturnType<typeof vi.fn>

    beforeEach(() => {
      writeMock = vi.fn().mockResolvedValue(undefined)
      writeTextMock = vi.fn().mockResolvedValue(undefined)
      vi.stubGlobal('navigator', {
        clipboard: { write: writeMock, writeText: writeTextMock }
      })
      vi.stubGlobal('ClipboardItem', class {
        items: Record<string, Blob>
        constructor(items: Record<string, Blob>) {
          this.items = items
        }
      })
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    async function writtenPayload() {
      const item = writeMock.mock.calls[0][0][0] as { items: Record<string, Blob> }
      return JSON.parse(await item.items[COMIND_BLOCK_MIME].text())
    }

    async function writtenPlainText() {
      const item = writeMock.mock.calls[0][0][0] as { items: Record<string, Blob> }
      return item.items['text/plain'].text()
    }

    test('写入结构化载荷（自定义 MIME JSON + text/plain 兜底）', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const block1 = await blockStore.createBlock({ pageId, content: '内容一', type: 'code' })
      const block2 = await blockStore.createBlock({ pageId, content: '内容二' })

      selection.anchorIds.add(block1.id)
      selection.anchorIds.add(block2.id)

      await selection.copyToClipboard()

      expect(writeMock).toHaveBeenCalledTimes(1)
      const payload = await writtenPayload()
      expect(payload.version).toBe(1)
      expect(payload.kind).toBe('blocks')
      expect(payload.blocks).toHaveLength(2)
      expect(payload.blocks[0].content).toBe('内容一')
      expect(payload.blocks[0].type).toBe('code')
      expect(payload.blocks[1].content).toBe('内容二')
      expect((await writtenPlainText()).split('\n')).toEqual(['内容一', '内容二'])
    })

    test('子树完整递归（后代未选中也随行，D10）', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const parent = await blockStore.createBlock({ pageId, content: '父' })
      await blockStore.createBlock({ pageId, content: '子', parentId: parent.id })

      selection.anchorIds.add(parent.id)

      await selection.copyToClipboard()

      const payload = await writtenPayload()
      expect(payload.blocks).toHaveLength(1)
      expect(payload.blocks[0].children).toHaveLength(1)
      expect(payload.blocks[0].children[0].content).toBe('子')
      // text/plain 保持缩进
      const lines = (await writtenPlainText()).split('\n')
      expect(lines[0]).toBe('父')
      expect(lines[1]).toMatch(/^\s+子/)
    })

    test('折叠块的后代同样被复制（折叠只是视图状态）', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const parent = await blockStore.createBlock({ pageId, content: '折叠父', format: { collapsed: true } })
      await blockStore.createBlock({ pageId, content: '隐藏子', parentId: parent.id })

      selection.anchorIds.add(parent.id)

      await selection.copyToClipboard()

      const payload = await writtenPayload()
      const children = (payload.blocks[0].children as Array<{ content: string }>).map(c => c.content)
      expect(children).toEqual(['隐藏子'])
    })

    test('同时选中父子时森林根不重复（子并入父的 children）', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const parent = await blockStore.createBlock({ pageId, content: '父' })
      const child = await blockStore.createBlock({ pageId, content: '子', parentId: parent.id })

      selection.anchorIds.add(parent.id)
      selection.anchorIds.add(child.id)

      await selection.copyToClipboard()

      const payload = await writtenPayload()
      expect(payload.blocks).toHaveLength(1)
      expect(payload.blocks[0].content).toBe('父')
      expect(payload.blocks[0].children).toHaveLength(1)
      expect(payload.blocks[0].children[0].id).toBe(child.id)
    })

    test('属性随行：propertyStore 实时缓存为权威（D11）', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const block = await blockStore.createBlock({ pageId, content: '带属性' })
      const propertyStore = usePropertyStore()
      propertyStore.propertiesByBlock.set(block.id, [{
        id: 'p1', blockId: block.id, key: 'status', value: 'Todo', type: 'string',
        sortOrder: 0, isHidden: false, isDeleted: false, schemaVersion: 1, createdAt: 0, updatedAt: 0
      }])

      selection.anchorIds.add(block.id)
      await selection.copyToClipboard()

      const payload = await writtenPayload()
      expect(payload.blocks[0].properties).toEqual({ status: { value: 'Todo', type: 'string' } })
    })

    test('store 缓存为空时回退 on-block 载入快照', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const block = await blockStore.createBlock({ pageId, content: '快照属性' })
      const b = blockStore.blocks.find(x => x.id === block.id)!
      b.properties = [{
        id: 'p2', block_id: block.id, key: 'priority', value: 'high', type: 'string',
        sort_order: 0, is_hidden: 0, is_deleted: 0, schema_version: 1, created_at: 0, updated_at: 0
      }]

      selection.anchorIds.add(block.id)
      await selection.copyToClipboard()

      const payload = await writtenPayload()
      expect(payload.blocks[0].properties).toEqual({ priority: { value: 'high', type: 'string' } })
    })

    test('空选区写入空森林与空文本', async () => {
      const selection = useCrossBlockSelection()

      await selection.copyToClipboard()

      expect(writeMock).toHaveBeenCalledTimes(1)
      const payload = await writtenPayload()
      expect(payload.blocks).toEqual([])
      expect(await writtenPlainText()).toBe('')
    })

    test('clipboard.write 失败时降级为 writeText（仅纯文本）', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const block = await blockStore.createBlock({ pageId, content: '降级' })
      selection.anchorIds.add(block.id)
      writeMock.mockRejectedValue(new Error('write failed'))

      await selection.copyToClipboard()

      expect(writeTextMock).toHaveBeenCalled()
      expect(writeTextMock.mock.calls[0][0]).toContain('降级')
    })

    test('write 与 writeText 均失败时 execCommand 兜底', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const block = await blockStore.createBlock({ pageId, content: '兜底' })
      selection.anchorIds.add(block.id)
      writeMock.mockRejectedValue(new Error('write failed'))
      writeTextMock.mockRejectedValue(new Error('writeText failed'))

      const execCommand = vi.fn()
      vi.stubGlobal('document', {
        createElement: vi.fn().mockReturnValue({ value: '', style: {}, select: vi.fn() }),
        body: { appendChild: vi.fn(), removeChild: vi.fn() },
        execCommand
      })

      await selection.copyToClipboard()

      expect(execCommand).toHaveBeenCalledWith('copy')
    })
  })

  describe('deleteSelected', () => {
    test('应删除所有 anchorIds 中的块', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const block1 = await blockStore.createBlock({ pageId, content: 'Block 1' })
      const block2 = await blockStore.createBlock({ pageId, content: 'Block 2' })
      const block3 = await blockStore.createBlock({ pageId, content: 'Block 3' })

      selection.anchorIds.add(block1.id)
      selection.anchorIds.add(block2.id)

      await selection.deleteSelected()

      expect(blockStore.blocks.find(b => b.id === block1.id)).toBeUndefined()
      expect(blockStore.blocks.find(b => b.id === block2.id)).toBeUndefined()
      expect(blockStore.blocks.find(b => b.id === block3.id)).toBeDefined()
    })

    test('应级联删除选中块的子块', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const parent = await blockStore.createBlock({ pageId, content: 'Parent' })
      const child = await blockStore.createBlock({ pageId, content: 'Child', parentId: parent.id })
      const grandchild = await blockStore.createBlock({ pageId, content: 'Grandchild', parentId: child.id })

      selection.anchorIds.add(parent.id)

      await selection.deleteSelected()

      expect(blockStore.blocks.find(b => b.id === parent.id)).toBeUndefined()
      expect(blockStore.blocks.find(b => b.id === child.id)).toBeUndefined()
      expect(blockStore.blocks.find(b => b.id === grandchild.id)).toBeUndefined()
    })

    test('删除后应清空 anchorIds 选区', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const block1 = await blockStore.createBlock({ pageId, content: 'Block 1' })
      const block2 = await blockStore.createBlock({ pageId, content: 'Block 2' })

      selection.anchorIds.add(block1.id)
      selection.anchorIds.add(block2.id)

      await selection.deleteSelected()

      expect(selection.anchorIds.size).toBe(0)
    })

    test('应触发 deleteBlock 持久化', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const block1 = await blockStore.createBlock({ pageId, content: 'Block 1' })
      selection.anchorIds.add(block1.id)

      const beforeCount = blockStore.blocks.length

      await selection.deleteSelected()

      expect(blockStore.blocks.length).toBe(beforeCount - 1)
      expect(blockStore.blocks.find(b => b.id === block1.id)).toBeUndefined()
    })

    test('空选区时应不执行任何删除', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      await blockStore.createBlock({ pageId, content: 'Block' })
      const beforeCount = blockStore.blocks.length

      await selection.deleteSelected()

      expect(blockStore.blocks.length).toBe(beforeCount)
    })

    test('边界条件', () => {
      const selection = useCrossBlockSelection()
      expect(selection.isBlockSelected('non-existent-id')).toBe(false)
    })
  })

  describe('边界条件', () => {
    test('computeRange 对不存在的目标块返回空集合', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const block = await blockStore.createBlock({ pageId, content: 'Block' })

      selection.startTracking(block.id)

      const range = selection.computeRange('non-existent', pageId)

      expect(range.size).toBe(0)
    })

    test('toggleBlock 切换已选中的子块应只取消该分支', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const block1 = await blockStore.createBlock({ pageId, content: 'Block 1' })
      const block2 = await blockStore.createBlock({ pageId, content: 'Block 2', parentId: block1.id })

      selection.toggleBlock(block1.id, pageId)
      selection.toggleBlock(block2.id, pageId)

      expect(selection.anchorIds.size).toBe(1)
      expect(selection.anchorIds.has(block1.id)).toBe(true)
      expect(selection.anchorIds.has(block2.id)).toBe(false)
    })

    test('选中不存在的块 ID 应安全处理', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const block = await blockStore.createBlock({ pageId, content: 'Block' })

      selection.anchorIds.add(block.id)

      expect(selection.isBlockSelected('non-existent-id')).toBe(false)
    })
  })

  describe('selectAll', () => {
    test('全选应把页面所有 Block（含子块）固化到 anchorIds', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const block1 = await blockStore.createBlock({ pageId, content: 'Block 1' })
      const block2 = await blockStore.createBlock({ pageId, content: 'Block 2' })
      const block3 = await blockStore.createBlock({ pageId, content: 'Block 3', parentId: block1.id })

      selection.selectAll(pageId)

      expect(selection.anchorIds.size).toBe(3)
      expect(selection.anchorIds.has(block1.id)).toBe(true)
      expect(selection.anchorIds.has(block2.id)).toBe(true)
      expect(selection.anchorIds.has(block3.id)).toBe(true)
    })

    test('全选应排除页面根 Block（excludeRootId）', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const root = await blockStore.createBlock({ pageId, content: 'root' })
      const child = await blockStore.createBlock({ pageId, content: 'child', parentId: root.id })

      selection.selectAll(pageId, root.id)

      expect(selection.anchorIds.has(root.id)).toBe(false)
      expect(selection.anchorIds.has(child.id)).toBe(true)
    })

    test('全选应清文本选区（互斥）', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const block = await blockStore.createBlock({ pageId, content: 'Block' })
      selection.startTextTracking({ blockId: block.id, offset: 0 }, { x: 0, y: 0 })
      selection.updateTextDrag({ blockId: block.id, offset: 3 })

      selection.selectAll(pageId)

      expect(selection.textRange.value).toBeNull()
    })

    test('全选应中断进行中的拖拽态', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const block = await blockStore.createBlock({ pageId, content: 'Block' })
      selection.startTracking(block.id)
      selection.isDragging.value = true
      selection.textDragAnchor.value = { blockId: block.id, offset: 0 }

      selection.selectAll(pageId)

      expect(selection.dragStartBlockId.value).toBeNull()
      expect(selection.isDragging.value).toBe(false)
      expect(selection.trackingFromProperty.value).toBe(false)
      expect(selection.textDragAnchor.value).toBeNull()
      expect(selection.anchorIds.has(block.id)).toBe(true)
    })

    test('全选应重置既有选区后再固化', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const block1 = await blockStore.createBlock({ pageId, content: 'Block 1' })
      const block2 = await blockStore.createBlock({ pageId, content: 'Block 2' })
      selection.anchorIds.add(block1.id)

      selection.selectAll(pageId)

      expect(selection.anchorIds.has(block1.id)).toBe(true)
      expect(selection.anchorIds.has(block2.id)).toBe(true)
    })
  })
})