import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBlockStore } from './blocks'
import { GAP_SIZE } from '../utils/block-helpers'

// Mock IndexedDB 存储层
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

describe('Gap 排序机制', () => {
  test('创建 Block 时自动分配 pos', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const first = await store.createBlock({ pageId, content: 'First' })
    expect(first.pos).toBe(GAP_SIZE)

    const second = await store.createBlock({ pageId, content: 'Second' })
    expect(second.pos).toBe(GAP_SIZE * 2)
  })

  test('子节点独立排序', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const parent = await store.createBlock({ pageId, content: 'Parent' })
    const child1 = await store.createBlock({ pageId, content: 'Child1', parentId: parent.id })
    const child2 = await store.createBlock({ pageId, content: 'Child2', parentId: parent.id })

    expect(child1.pos).toBe(GAP_SIZE)
    expect(child2.pos).toBe(GAP_SIZE * 2)
  })

  test('排序正确', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    await store.createBlock({ pageId, content: 'A' })
    await store.createBlock({ pageId, content: 'B' })
    await store.createBlock({ pageId, content: 'C' })

    const sorted = store.sortedBlocks
    expect(sorted[0].content).toBe('A')
    expect(sorted[1].content).toBe('B')
    expect(sorted[2].content).toBe('C')
  })
})

describe('splitBlock - Enter 拆分', () => {
  test('按光标位置拆分 Block', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const block = await store.createBlock({ pageId, content: 'Hello World' })
    await store.splitBlock(block.id, 5)

    const updatedBlock = store.blocks.find(b => b.id === block.id)
    expect(updatedBlock?.content).toBe('Hell')

    const newBlock = store.blocks.find(b => b.content === 'o World')
    expect(newBlock).toBeDefined()
    expect(newBlock?.pos).toBeGreaterThan(block.pos)
  })

  test('折叠状态拆分，新 Block 作为子节点', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const parent = await store.createBlock({ pageId, content: 'Parent' })
    await store.splitBlock(parent.id, 4, true)

    const newBlock = store.blocks.find(b => b.content === 'ent')
    expect(newBlock).toBeDefined()
    expect(newBlock?.parentId).toBe(parent.id)
  })

  test('展开状态拆分，新 Block 作为兄弟节点', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const parent = await store.createBlock({ pageId, content: 'Parent' })
    await store.splitBlock(parent.id, 4, false)

    const newBlock = store.blocks.find(b => b.content === 'ent')
    expect(newBlock).toBeDefined()
    expect(newBlock?.parentId).toBe(null)
    expect(newBlock?.pos).toBeGreaterThan(parent.pos)
  })
})

describe('mergeWithPrevious - Backspace 合并', () => {
  test('光标在开头时，与上一个 Block 合并', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const first = await store.createBlock({ pageId, content: 'Hello' })
    const second = await store.createBlock({ pageId, content: 'World' })

    const result = await store.mergeWithPrevious(second.id)

    expect(result).toBeDefined()
    expect(result!.id).toBe(first.id)
    expect(result!.cursorPos).toBe(6)

    const updatedFirst = store.blocks.find(b => b.id === first.id)
    expect(updatedFirst?.content).toBe('HelloWorld')

    const deletedBlock = store.blocks.find(b => b.id === second.id)
    expect(deletedBlock).toBeUndefined()
  })

  test('第一个 Block 无法合并', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const first = await store.createBlock({ pageId, content: 'Only' })
    const result = await store.mergeWithPrevious(first.id)

    expect(result).toBeUndefined()
    expect(store.blocks).toHaveLength(1)
  })
})

describe('indent/outdent 操作', () => {
  test('Indent 使 Block 成为前兄弟的子节点', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const parent = await store.createBlock({ pageId, content: 'Parent' })
    const child = await store.createBlock({ pageId, content: 'Child' })

    await store.indent(child.id)

    const updatedChild = store.blocks.find(b => b.id === child.id)
    expect(updatedChild?.parentId).toBe(parent.id)

    const children = store.getChildren(parent.id)
    expect(children).toHaveLength(1)
  })

  test('Outdent 使 Block 提升到父节点层级', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const parent = await store.createBlock({ pageId, content: 'Parent' })
    const child = await store.createBlock({ pageId, content: 'Child', parentId: parent.id })

    await store.outdent(child.id)

    const updatedChild = store.blocks.find(b => b.id === child.id)
    expect(updatedChild?.parentId).toBe(null)
  })

  test('多级缩进保持正确顺序', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const parent = await store.createBlock({ pageId, content: 'Parent' })
    await store.createBlock({ pageId, content: 'Child1', parentId: parent.id })
    await store.createBlock({ pageId, content: 'Child2', parentId: parent.id })

    const newBlock = await store.createBlock({ pageId, content: 'New' })
    await store.indent(newBlock.id)

    const children = store.getChildren(parent.id)
    expect(children.length).toBe(3)
    expect(children[2].content).toBe('New')
  })
})

describe('deleteBlock', () => {
  test('删除空 Block', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const block = await store.createBlock({ pageId, content: '' })
    await store.deleteBlock(block.id)

    expect(store.blocks).toHaveLength(0)
  })

  test('递归删除子节点', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const parent = await store.createBlock({ pageId, content: 'Parent' })
    await store.createBlock({ pageId, content: 'Child1', parentId: parent.id })
    await store.createBlock({ pageId, content: 'Child2', parentId: parent.id })

    await store.deleteBlock(parent.id)

    expect(store.blocks).toHaveLength(0)
  })
})

describe('moveBlock', () => {
  test('移动到新位置', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    await store.createBlock({ pageId, content: 'A' })
    await store.createBlock({ pageId, content: 'B' })
    const c = await store.createBlock({ pageId, content: 'C' })

    // 移动 C 到 A 之后（index 1）
    await store.moveBlock({
      blockId: c.id,
      toParentId: null,
      newIndex: 1
    })

    const sorted = store.sortedBlocks
    expect(sorted[0].content).toBe('A')
    expect(sorted[1].content).toBe('C')
    expect(sorted[2].content).toBe('B')
  })

  test('禁止循环移动', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const parent = await store.createBlock({ pageId, content: 'Parent' })
    const child = await store.createBlock({ pageId, content: 'Child', parentId: parent.id })

    // 尝试将 parent 移动到 child 下（应该被阻止）
    await store.moveBlock({
      blockId: parent.id,
      toParentId: child.id,
      newIndex: 0
    })

    const updatedParent = store.blocks.find(b => b.id === parent.id)
    expect(updatedParent?.parentId).toBe(null) // 未改变
  })
})

describe('性能测试', () => {
  test('大量节点排序性能', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const startTime = performance.now()
    for (let i = 0; i < 1000; i++) {
      await store.createBlock({ pageId, content: `Node ${i}` })
    }
    const endTime = performance.now()

    expect(endTime - startTime).toBeLessThan(2000)
  })
})
