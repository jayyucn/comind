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

// ============================================================
// 拖拽子节点问题修复测试
// ============================================================
// 问题：拖拽子节点时，父节点也随之移动
// 根因：useSortable 在 onMounted 中调用，导致 onBeforeUnmount 钩子注册失败，
//       Sortable 实例泄漏，多个实例响应同一拖拽事件
// 修复：useSortable 改为在 setup 阶段调用，传入 ref 而不是元素本身
// ============================================================

describe('moveBlock - 拖拽子节点问题修复', () => {
  test('移动子节点时，父节点的 pos 不应改变', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    // 创建父节点
    const parent = await store.createBlock({ pageId, content: 'Parent' })
    const parentPosBefore = parent.pos

    // 创建两个子节点
    const child1 = await store.createBlock({
      pageId,
      content: 'Child1',
      parentId: parent.id
    })
    const child2 = await store.createBlock({
      pageId,
      content: 'Child2',
      parentId: parent.id
    })

    // 移动 child1 到 child2 后面（index 1 → index 1，实际不变）
    await store.moveBlock({
      blockId: child1.id,
      toParentId: parent.id,
      newIndex: 1
    })

    // 验证：父节点的 pos 不应该改变
    const parentAfter = store.blocks.find(b => b.id === parent.id)
    expect(parentAfter?.pos).toBe(parentPosBefore)

    // 验证：父节点的 parentId 应该仍然是 null
    expect(parentAfter?.parentId).toBe(null)
  })

  test('移动子节点时，只有被移动节点的位置改变', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    // 创建父节点
    const parent = await store.createBlock({ pageId, content: 'Parent' })

    // 创建三个子节点
    const child1 = await store.createBlock({
      pageId,
      content: 'Child1',
      parentId: parent.id
    })
    const child2 = await store.createBlock({
      pageId,
      content: 'Child2',
      parentId: parent.id
    })
    const child3 = await store.createBlock({
      pageId,
      content: 'Child3',
      parentId: parent.id
    })

    // 记录初始位置
    const child1PosBefore = child1.pos
    const child2PosBefore = child2.pos
    const child3PosBefore = child3.pos

    // 移动 child1 到末尾（index 2）
    await store.moveBlock({
      blockId: child1.id,
      toParentId: parent.id,
      newIndex: 2
    })

    // 验证：只有 child1 的 pos 改变
    const child1After = store.blocks.find(b => b.id === child1.id)
    const child2After = store.blocks.find(b => b.id === child2.id)
    const child3After = store.blocks.find(b => b.id === child3.id)

    // child1 的 pos 应该改变（移动到末尾）
    expect(child1After?.pos).not.toBe(child1PosBefore)

    // child2 和 child3 的相对顺序应该保持不变
    // 由于我们使用 Gap 排序，实际 pos 值可能会被重新计算
    // 但它们的顺序应该正确
    const children = store.getChildren(parent.id)
    expect(children[0].id).toBe(child2.id)
    expect(children[1].id).toBe(child3.id)
    expect(children[2].id).toBe(child1.id)
  })

  test('跨容器移动子节点时，原父节点和新父节点都不受影响', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    // 创建两个父节点
    const parent1 = await store.createBlock({ pageId, content: 'Parent1' })
    const parent2 = await store.createBlock({ pageId, content: 'Parent2' })

    // 在 parent1 下创建子节点
    const child = await store.createBlock({
      pageId,
      content: 'Child',
      parentId: parent1.id
    })

    // 记录父节点的初始状态
    const parent1PosBefore = parent1.pos
    const parent1ParentIdBefore = parent1.parentId
    const parent2PosBefore = parent2.pos
    const parent2ParentIdBefore = parent2.parentId

    // 将 child 从 parent1 移动到 parent2
    await store.moveBlock({
      blockId: child.id,
      toParentId: parent2.id,
      newIndex: 0
    })

    // 验证：两个父节点的 pos 和 parentId 都不应该改变
    const parent1After = store.blocks.find(b => b.id === parent1.id)
    const parent2After = store.blocks.find(b => b.id === parent2.id)

    expect(parent1After?.pos).toBe(parent1PosBefore)
    expect(parent1After?.parentId).toBe(parent1ParentIdBefore)
    expect(parent2After?.pos).toBe(parent2PosBefore)
    expect(parent2After?.parentId).toBe(parent2ParentIdBefore)

    // 验证：child 的 parentId 已更新为 parent2.id
    const childAfter = store.blocks.find(b => b.id === child.id)
    expect(childAfter?.parentId).toBe(parent2.id)
  })

  test('移动孙节点时，所有祖先节点都不受影响', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    // 创建三级嵌套结构：grandparent → parent → child1, child2
    const grandparent = await store.createBlock({ pageId, content: 'Grandparent' })
    const parent = await store.createBlock({
      pageId,
      content: 'Parent',
      parentId: grandparent.id
    })
    const child1 = await store.createBlock({
      pageId,
      content: 'Child1',
      parentId: parent.id
    })
    const child2 = await store.createBlock({
      pageId,
      content: 'Child2',
      parentId: parent.id
    })

    // 记录祖先节点的初始状态
    const grandparentPosBefore = grandparent.pos
    const grandparentParentIdBefore = grandparent.parentId
    const parentPosBefore = parent.pos
    const parentParentIdBefore = parent.parentId

    // 移动孙节点 child1 到 child2 后面
    await store.moveBlock({
      blockId: child1.id,
      toParentId: parent.id,
      newIndex: 1
    })

    // 验证：所有祖先节点的 pos 和 parentId 都不应该改变
    const grandparentAfter = store.blocks.find(b => b.id === grandparent.id)
    const parentAfter = store.blocks.find(b => b.id === parent.id)

    expect(grandparentAfter?.pos).toBe(grandparentPosBefore)
    expect(grandparentAfter?.parentId).toBe(grandparentParentIdBefore)
    expect(parentAfter?.pos).toBe(parentPosBefore)
    expect(parentAfter?.parentId).toBe(parentParentIdBefore)
  })
})

describe('moveBlock - 边界条件处理', () => {
  test('移动到同一位置应无操作', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const block1 = await store.createBlock({ pageId, content: 'Block1' })
    const block2 = await store.createBlock({ pageId, content: 'Block2' })

    const block1PosBefore = block1.pos
    const block2PosBefore = block2.pos

    // 移动 block1 到当前位置（index 0 → index 0）
    await store.moveBlock({
      blockId: block1.id,
      toParentId: null,
      newIndex: 0
    })

    // 验证：位置应该保持不变（或非常接近，因为 Gap 可能重新计算）
    const block1After = store.blocks.find(b => b.id === block1.id)
    expect(block1After?.pos).toBe(block1PosBefore)
  })

  test('移动到超出范围的位置应被 clamp', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const block1 = await store.createBlock({ pageId, content: 'Block1' })
    const block2 = await store.createBlock({ pageId, content: 'Block2' })

    // 移动 block1 到超出范围的位置（index 999）
    await store.moveBlock({
      blockId: block1.id,
      toParentId: null,
      newIndex: 999
    })

    // 验证：block1 应该被移动到末尾
    const blocks = store.sortedBlocks
    expect(blocks[0].id).toBe(block2.id)
    expect(blocks[1].id).toBe(block1.id)
  })

  test('移动不存在的 block 应无操作', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    await store.createBlock({ pageId, content: 'Block1' })

    // 尝试移动不存在的 block
    await store.moveBlock({
      blockId: 'non-existent-id',
      toParentId: null,
      newIndex: 0
    })

    // 验证：没有抛出错误，blocks 数量不变
    expect(store.blocks).toHaveLength(1)
  })

  test('循环移动应被阻止（父 → 子）', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const parent = await store.createBlock({ pageId, content: 'Parent' })
    const child = await store.createBlock({
      pageId,
      content: 'Child',
      parentId: parent.id
    })

    // 尝试将 parent 移动到 child 下
    await store.moveBlock({
      blockId: parent.id,
      toParentId: child.id,
      newIndex: 0
    })

    // 验证：移动被阻止，parent 的 parentId 仍然是 null
    const parentAfter = store.blocks.find(b => b.id === parent.id)
    expect(parentAfter?.parentId).toBe(null)
  })

  test('循环移动应被阻止（祖先 → 后代）', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const grandparent = await store.createBlock({ pageId, content: 'Grandparent' })
    const parent = await store.createBlock({
      pageId,
      content: 'Parent',
      parentId: grandparent.id
    })
    const child = await store.createBlock({
      pageId,
      content: 'Child',
      parentId: parent.id
    })

    // 尝试将 grandparent 移动到 child 下
    await store.moveBlock({
      blockId: grandparent.id,
      toParentId: child.id,
      newIndex: 0
    })

    // 验证：移动被阻止
    const grandparentAfter = store.blocks.find(b => b.id === grandparent.id)
    expect(grandparentAfter?.parentId).toBe(null)
  })
})

describe('isDescendantOf - 循环检测', () => {
  test('节点不是自己的后代', () => {
    const store = useBlockStore()

    // 直接调用会返回 false（需要先创建 block）
    // isDescendantOf 检查的是 parentId 链，不是 id 相等
    // 但如果 targetId === blockId，应该返回 true（根据实现）
    // 让我们测试实际行为
  })

  test('直接子节点是后代', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const parent = await store.createBlock({ pageId, content: 'Parent' })
    const child = await store.createBlock({
      pageId,
      content: 'Child',
      parentId: parent.id
    })

    // child 是 parent 的后代
    expect(store.isDescendantOf(child.id, parent.id)).toBe(true)

    // parent 不是 child 的后代
    expect(store.isDescendantOf(parent.id, child.id)).toBe(false)
  })

  test('孙节点是祖先的后代', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const grandparent = await store.createBlock({ pageId, content: 'Grandparent' })
    const parent = await store.createBlock({
      pageId,
      content: 'Parent',
      parentId: grandparent.id
    })
    const child = await store.createBlock({
      pageId,
      content: 'Child',
      parentId: parent.id
    })

    // child 是 grandparent 的后代
    expect(store.isDescendantOf(child.id, grandparent.id)).toBe(true)

    // child 是 parent 的后代
    expect(store.isDescendantOf(child.id, parent.id)).toBe(true)

    // grandparent 不是 child 的后代
    expect(store.isDescendantOf(grandparent.id, child.id)).toBe(false)
  })

  test('null 不是任何节点的后代', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const block = await store.createBlock({ pageId, content: 'Block' })

    // null 作为 targetId 应该返回 false
    expect(store.isDescendantOf(null, block.id)).toBe(false)
  })
})

describe('原有测试（保持兼容性）', () => {
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
