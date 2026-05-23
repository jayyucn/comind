import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBlockStore } from '../stores/blocks'
import { useCrossBlockSelection } from './useCrossBlockSelection'

vi.mock('../storage/indexedDB', () => ({
  storage: {
    saveBlock: vi.fn(),
    deleteBlock: vi.fn(),
    deleteBlockCascade: vi.fn(),
    getBlockTree: vi.fn().mockResolvedValue([])
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

  describe('copyToClipboard', () => {
    beforeEach(() => {
      vi.stubGlobal('navigator', {
        clipboard: {
          writeText: vi.fn().mockResolvedValue(undefined)
        }
      })
    })

    test('应复制选中块的内容', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const block1 = await blockStore.createBlock({ pageId, content: 'Content 1' })
      const block2 = await blockStore.createBlock({ pageId, content: 'Content 2' })

      selection.anchorIds.add(block1.id)
      selection.anchorIds.add(block2.id)

      await selection.copyToClipboard()

      expect(navigator.clipboard.writeText).toHaveBeenCalled()
      const writtenText = (navigator.clipboard.writeText as any).mock.calls[0][0]
      expect(writtenText).toContain('Content 1')
      expect(writtenText).toContain('Content 2')
    })

    test('选中块包含子块时应同时选中子块才能复制', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const parent = await blockStore.createBlock({ pageId, content: 'Parent' })
      const child = await blockStore.createBlock({ pageId, content: 'Child', parentId: parent.id })

      selection.anchorIds.add(parent.id)
      selection.anchorIds.add(child.id)

      await selection.copyToClipboard()

      const writtenText = (navigator.clipboard.writeText as any).mock.calls[0][0]
      expect(writtenText).toContain('Parent')
      expect(writtenText).toContain('Child')
    })

    test('折叠块不应复制子块内容', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const parent = await blockStore.createBlock({ pageId, content: 'Parent', format: { collapsed: true } })
      await blockStore.createBlock({ pageId, content: 'Hidden Child', parentId: parent.id })

      selection.anchorIds.add(parent.id)

      await selection.copyToClipboard()

      const writtenText = (navigator.clipboard.writeText as any).mock.calls[0][0]
      expect(writtenText).toContain('Parent')
      expect(writtenText).not.toContain('Hidden Child')
    })

    test('应保持树形缩进', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const root = await blockStore.createBlock({ pageId, content: 'Root' })
      const child = await blockStore.createBlock({ pageId, content: 'Child', parentId: root.id })

      selection.anchorIds.add(root.id)
      selection.anchorIds.add(child.id)

      await selection.copyToClipboard()

      const writtenText = (navigator.clipboard.writeText as any).mock.calls[0][0]
      const lines = writtenText.split('\n')
      expect(lines[0]).toBe('Root')
      expect(lines[1]).toMatch(/^\s+Child/)
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

    test('copyToClipboard 空选区时写入空字符串', async () => {
      const selection = useCrossBlockSelection()

      await selection.copyToClipboard()

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('')
    })

    test('选中不存在的块 ID 应安全处理', async () => {
      const selection = useCrossBlockSelection()
      const pageId = 'page-1'

      const block = await blockStore.createBlock({ pageId, content: 'Block' })

      selection.anchorIds.add(block.id)

      expect(selection.isBlockSelected('non-existent-id')).toBe(false)
    })
  })
})
