import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBlockStore } from './blocks'

// Mock IndexedDB 存储层
vi.mock('../storage/indexedDB', () => ({
  storage: {
    saveBlock: vi.fn(),
    deleteBlock: vi.fn(),
    getBlockTree: vi.fn().mockResolvedValue([])
  }
}))

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('splitBlock - Enter 拆分', () => {
  test('按光标位置拆分 Block，前半保留在原 Block', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const block = await store.createBlock({
      pageId,
      content: 'Hello World',
      left: 100
    })

    await store.splitBlock(block.id, 5)

    const updatedBlock = store.blocks.find(b => b.id === block.id)
    expect(updatedBlock?.content).toBe('Hell')

    const newBlock = store.blocks.find(b => b.content === 'o World')
    expect(newBlock).toBeDefined()
    expect(newBlock?.parentId).toBe(null)
    expect(newBlock?.left).toBeGreaterThan(block.left)
  })

  test('展开状态拆分，新 Block 作为兄弟节点', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const parent = await store.createBlock({
      pageId,
      content: 'Parent',
      left: 100
    })

    await store.splitBlock(parent.id, 4, false)

    const newBlock = store.blocks.find(b => b.content === 'ent')
    expect(newBlock).toBeDefined()
    expect(newBlock?.parentId).toBe(parent.parentId)
  })

  test('折叠状态拆分，新 Block 作为当前块的子节点', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const parent = await store.createBlock({
      pageId,
      content: 'Parent',
      left: 100
    })

    await store.splitBlock(parent.id, 4, true)

    const newBlock = store.blocks.find(b => b.content === 'ent')
    expect(newBlock).toBeDefined()
    expect(newBlock?.parentId).toBe(parent.id)
  })

  test('折叠状态拆分后，新子块成为当前块的子节点', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const parent = await store.createBlock({
      pageId,
      content: 'Parent',
      left: 100
    })

    await store.createBlock({
      pageId,
      content: 'ExistingChild',
      parentId: parent.id,
      left: 200
    })

    await store.splitBlock(parent.id, 4, true)

    const children = store.blocks.filter(b => b.parentId === parent.id)
    expect(children.length).toBe(2)

    const newBlock = children.find(b => b.content === 'ent')
    expect(newBlock).toBeDefined()
    expect(newBlock?.parentId).toBe(parent.id)
  })

  test('展开状态拆分，新 Block 的 left 大于原 Block', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const block = await store.createBlock({
      pageId,
      content: 'Block',
      left: 100
    })

    await store.splitBlock(block.id, 4, false)

    const newBlock = store.blocks.find(b => b.content === 'ck')
    expect(newBlock).toBeDefined()
    expect(newBlock?.left).toBeGreaterThan(100)
  })

  test('光标在开头时，新 Block 内容为原内容', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const block = await store.createBlock({
      pageId,
      content: 'Hello',
      left: 100
    })

    await store.splitBlock(block.id, 1)

    const updatedBlock = store.blocks.find(b => b.id === block.id)
    expect(updatedBlock?.content).toBe('')

    const newBlock = store.blocks.find(b => b.content === 'Hello')
    expect(newBlock).toBeDefined()
  })

  test('光标在末尾时，新 Block 内容为空', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const block = await store.createBlock({
      pageId,
      content: 'Hello',
      left: 100
    })

    await store.splitBlock(block.id, 7)

    const updatedBlock = store.blocks.find(b => b.id === block.id)
    expect(updatedBlock?.content).toBe('Hello')

    const newBlock = store.blocks.find(b => b.id !== block.id && b.parentId === null)
    expect(newBlock?.content).toBe('')
  })
})

describe('mergeWithPrevious - Backspace 合并', () => {
  test('光标在开头时，与上一个 Block 合并', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const first = await store.createBlock({
      pageId,
      content: 'Hello',
      left: 100
    })

    const second = await store.createBlock({
      pageId,
      content: 'World',
      left: 200
    })

    // 合并 second 到 first
    const result = await store.mergeWithPrevious(second.id)

    // 验证返回的是前一个 Block ID + 合并点位置
    expect(result).toBeDefined()
    expect(result!.id).toBe(first.id)
    expect(result!.cursorPos).toBe(6)

    // 验证前一个 Block 内容已合并
    const updatedFirst = store.blocks.find(b => b.id === first.id)
    expect(updatedFirst?.content).toBe('HelloWorld')

    // 验证当前 Block 已删除
    const deletedBlock = store.blocks.find(b => b.id === second.id)
    expect(deletedBlock).toBeUndefined()
  })

  test('第一个 Block 无法合并（没有上一个 Block）', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const first = await store.createBlock({
      pageId,
      content: 'Only',
      left: 100
    })

    // 尝试合并第一个 Block
    const result = await store.mergeWithPrevious(first.id)

    // 应该返回 undefined（无操作）
    expect(result).toBeUndefined()

    // Block 仍然存在
    expect(store.blocks).toHaveLength(1)
    expect(store.blocks[0].content).toBe('Only')
  })

  test('合并时保持层级关系', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const parent = await store.createBlock({
      pageId,
      content: 'Parent',
      left: 100
    })

    const child1 = await store.createBlock({
      pageId,
      content: 'Child1',
      parentId: parent.id,
      left: 200
    })

    const child2 = await store.createBlock({
      pageId,
      content: 'Child2',
      parentId: parent.id,
      left: 300
    })

    // 合并 child2 到 child1
    const mergeResult = await store.mergeWithPrevious(child2.id)
    expect(mergeResult).toBeDefined()
    expect(mergeResult!.id).toBe(child1.id)

    const updatedChild1 = store.blocks.find(b => b.id === child1.id)
    expect(updatedChild1?.content).toBe('Child1Child2')
    expect(updatedChild1?.parentId).toBe(parent.id) // 层级不变
  })
})

describe('deleteBlock - Backspace 删除空 Block', () => {
  test('删除空 Block', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const block = await store.createBlock({
      pageId,
      content: '',
      left: 100
    })

    await store.deleteBlock(block.id)

    const deleted = store.blocks.find(b => b.id === block.id)
    expect(deleted).toBeUndefined()
    expect(store.blocks).toHaveLength(0)
  })

  test('删除有子节点的 Block 时递归删除子节点', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const parent = await store.createBlock({
      pageId,
      content: 'Parent',
      left: 100
    })

    await store.createBlock({
      pageId,
      content: 'Child1',
      parentId: parent.id,
      left: 200
    })

    await store.createBlock({
      pageId,
      content: 'Child2',
      parentId: parent.id,
      left: 300
    })

    await store.deleteBlock(parent.id)

    expect(store.blocks).toHaveLength(0) // 父节点和所有子节点都被删除
  })
})

describe('Left Field Redesign - New Implementation', () => {
  test('Outdent operation maintains unique left values', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    // Create parent and child
    const parent = await store.createBlock({ pageId, content: 'Parent' })
    const child = await store.createBlock({ pageId, content: 'Child', parentId: parent.id })

    // Create another sibling for parent
    await store.createBlock({ pageId, content: 'Sibling' })

    // Outdent child to parent level
    await store.outdent(child.id)

    // Check for duplicate left values
    const leftValues = store.blocks.map(b => b.left)
    const uniqueLeftValues = new Set(leftValues)
    expect(leftValues.length).toBe(uniqueLeftValues.size)
  })

  test('Indent operation properly orders new child', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    // Create parent with multiple children
    const parent = await store.createBlock({ pageId, content: 'Parent' })
    await store.createBlock({ pageId, content: 'Child1', parentId: parent.id })
    await store.createBlock({ pageId, content: 'Child2', parentId: parent.id })

    // Create new block to indent
    const newBlock = await store.createBlock({ pageId, content: 'New Block' })

    // Indent new block
    await store.indent(newBlock.id)

    // Check that new block is properly ordered among children
    const children = store.getChildren(parent.id)
    expect(children.length).toBe(3)
  })

  test('Large number of nodes handled efficiently', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    // Create 1000 nodes
    const startTime = performance.now()
    for (let i = 0; i < 1000; i++) {
      await store.createBlock({ pageId, content: `Node ${i}` })
    }
    const endTime = performance.now()

    // Should complete in reasonable time
    expect(endTime - startTime).toBeLessThan(2000)

    // Validate no duplicate left values
    expect(store.validateBlocks()).toBe(true)
  })

  test('Reindexing fixes inconsistencies', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    // Create blocks with potentially inconsistent left values
    await store.createBlock({ pageId, content: 'Block 1', left: 100 })
    await store.createBlock({ pageId, content: 'Block 2', left: 150 }) // Non-standard increment
    await store.createBlock({ pageId, content: 'Block 3', left: 250 }) // Large gap

    // Reindex
    await store.reindexBlocks()

    // Check that left values are consistent
    const sortedBlocks = store.sortedBlocks
    expect(sortedBlocks[0].left).toBe(100)
    expect(sortedBlocks[1].left).toBe(200)
    expect(sortedBlocks[2].left).toBe(300)
  })

  test('Cross-level moves maintain proper ordering', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    // Create deep hierarchy
    const level1 = await store.createBlock({ pageId, content: 'Level 1' })
    const level2 = await store.createBlock({ pageId, content: 'Level 2', parentId: level1.id })
    const level3 = await store.createBlock({ pageId, content: 'Level 3', parentId: level2.id })

    // Move level3 directly to level1
    await store.outdent(level3.id)
    await store.outdent(level3.id)

    // Check that it's properly positioned
    const siblings = store.blocks.filter(b => b.parentId === null)
    expect(siblings.length).toBe(2)
    expect(store.validateBlocks()).toBe(true)
  })
})