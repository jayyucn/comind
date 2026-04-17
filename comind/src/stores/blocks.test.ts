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

    // 创建初始 Block
    const block = await store.createBlock({
      pageId,
      content: 'Hello World',
      left: 100
    })

    // 在位置 5 拆分（Hello|World）
    await store.splitBlock(block.id, 5)

    // 验证原 Block 内容
    const updatedBlock = store.blocks.find(b => b.id === block.id)
    expect(updatedBlock?.content).toBe('Hello')

    // 验证新 Block 内容（注意：after 包含前导空格）
    const newBlock = store.blocks.find(b => b.content === ' World')
    expect(newBlock).toBeDefined()
    expect(newBlock?.parentId).toBe(null) // 兄弟节点
    expect(newBlock?.left).toBeGreaterThan(block.left)
  })

  test('新 Block 作为兄弟节点（parentId 相同）', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const parent = await store.createBlock({
      pageId,
      content: 'Parent',
      left: 100
    })

    const child = await store.createBlock({
      pageId,
      content: 'ChildBlock',
      parentId: parent.id,
      left: 200
    })

    // 拆分子节点
    await store.splitBlock(child.id, 5)

    const newBlock = store.blocks.find(b => b.content === 'Block')
    expect(newBlock?.parentId).toBe(parent.id) // 保持同一 parent
  })

  test('光标在开头时，新 Block 内容为空', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const block = await store.createBlock({
      pageId,
      content: 'Hello',
      left: 100
    })

    await store.splitBlock(block.id, 0)

    const updatedBlock = store.blocks.find(b => b.id === block.id)
    expect(updatedBlock?.content).toBe('') // 原 Block 变空

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

    await store.splitBlock(block.id, 5)

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
    const resultId = await store.mergeWithPrevious(second.id)

    // 验证返回的是前一个 Block ID
    expect(resultId).toBe(first.id)

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
    const resultId = await store.mergeWithPrevious(first.id)

    // 应该返回 undefined（无操作）
    expect(resultId).toBeUndefined()

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
    await store.mergeWithPrevious(child2.id)

    const updatedChild1 = store.blocks.find(b => b.id === child1.id)
    expect(updatedChild1?.content).toBe('Child1Child2')
    expect(updatedChild1?.parentId).toBe(parent.id) // 层级不变
  })
})
