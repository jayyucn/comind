
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBlockStore } from './src/stores/blocks'

// Mock IndexedDB 存储层
import { vi } from 'vitest'

vi.mock('./src/storage/indexedDB', () => ({
  storage: {
    saveBlock: vi.fn(),
    deleteBlock: vi.fn(),
    deleteBlockCascade: vi.fn(),
    getBlockTree: vi.fn().mockResolvedValue([])
  }
}))

describe('mergeWithPrevious - 子节点处理验证', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('合并块后子节点应该仍然存在，不应该被删除', async () => {
    const store = useBlockStore()
    const pageId = 'test-page'

    // 创建测试数据
    const blockX = await store.createBlock({ pageId, content: 'X' })
    const blockA = await store.createBlock({ pageId, content: 'A' })
    const blockC = await store.createBlock({
      pageId,
      content: 'Child of A',
      parentId: blockA.id
    })

    // 验证初始状态
    const initialBlockC = store.blocks.find(function(b) { return b.id === blockC.id })
    expect(initialBlockC).toBeDefined()
    expect(initialBlockC?.parentId).toBe(blockA.id)

    // 执行合并
    await store.mergeWithPrevious(blockA.id)

    // 验证 blockA 被删除
    const blockAAfter = store.blocks.find(function(b) { return b.id === blockA.id })
    expect(blockAAfter).toBeUndefined()

    // 验证 blockC 仍然存在，并且 parentId 变为 blockX.id
    const blockCAfter = store.blocks.find(function(b) { return b.id === blockC.id })
    expect(blockCAfter).toBeDefined()
    expect(blockCAfter?.parentId).toBe(blockX.id)
  })
})
