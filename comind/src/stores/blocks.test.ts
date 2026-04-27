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

  // ── 条件A：前驱没有子 Block / 已折叠 → 直接与前驱合并 ──────────────

  test('前驱没有子 Block → 直接与前驱合并', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const first = await store.createBlock({ pageId, content: 'A' })
    const second = await store.createBlock({ pageId, content: 'B' })

    const result = await store.mergeWithPrevious(second.id)

    expect(result).toBeDefined()
    expect(result!.id).toBe(first.id)
    expect(result!.cursorPos).toBe(2) // 'A'.length + 1
    expect(store.blocks.find(b => b.id === first.id)?.content).toBe('AB')
    expect(store.blocks).toHaveLength(1)
  })

  test('前驱已折叠（format.collapsed=true）→ 直接与前驱合并', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const parent = await store.createBlock({ pageId, content: 'Parent' })
    const child = await store.createBlock({ pageId, content: 'Child', parentId: parent.id })
    const next = await store.createBlock({ pageId, content: 'Next' })

    // 将 parent 设为折叠
    await store.updateBlockFormat(parent.id, { collapsed: true })

    // findLastVisibleDescendant 会在 parent 处停下（因为 collapsed=true）
    const result = await store.mergeWithPrevious(next.id)

    expect(result).toBeDefined()
    expect(result!.id).toBe(parent.id) // 合并到折叠的 parent
    expect(result!.cursorPos).toBe(7) // 'Parent'.length + 1
    expect(store.blocks.find(b => b.id === parent.id)?.content).toBe('ParentNext')
    // child 仍然存在
    expect(store.blocks.find(b => b.id === child.id)).toBeDefined()
  })

  // ── 条件B：前驱有展开的子 Block → 合并到最后一个可见后代 ──────────

  test('前驱有展开的子 Block → 合并到最后一个子节点', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const parent = await store.createBlock({ pageId, content: 'Parent' })
    await store.createBlock({ pageId, content: 'Child1', parentId: parent.id })
    const child2 = await store.createBlock({ pageId, content: 'Child2', parentId: parent.id })
    const next = await store.createBlock({ pageId, content: 'Next' })

    // parent 未折叠（默认），有展开的子 Block
    const result = await store.mergeWithPrevious(next.id)

    expect(result).toBeDefined()
    expect(result!.id).toBe(child2.id) // 合并到最后一个子节点
    expect(result!.cursorPos).toBe(7) // 'Child2'.length + 1
    expect(store.blocks.find(b => b.id === child2.id)?.content).toBe('Child2Next')
    expect(store.blocks).toHaveLength(3) // parent, child1, child2（next 已删除）
  })

  test('多级嵌套且全部展开 → 合并到最深末端可见后代', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const root = await store.createBlock({ pageId, content: 'Root' })
    const level1 = await store.createBlock({ pageId, content: 'L1', parentId: root.id })
    const level2 = await store.createBlock({ pageId, content: 'L2', parentId: level1.id })
    const level3 = await store.createBlock({ pageId, content: 'L3', parentId: level2.id })
    const next = await store.createBlock({ pageId, content: 'Next' })

    // 全部展开 → 合并到 level3
    const result = await store.mergeWithPrevious(next.id)

    expect(result).toBeDefined()
    expect(result!.id).toBe(level3.id)
    expect(result!.cursorPos).toBe(3) // 'L3'.length + 1
    expect(store.blocks.find(b => b.id === level3.id)?.content).toBe('L3Next')
  })

  test('多级嵌套且中间层折叠 → 合并到折叠层（不深入）', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const root = await store.createBlock({ pageId, content: 'Root' })
    const level1 = await store.createBlock({ pageId, content: 'L1', parentId: root.id })
    const level2 = await store.createBlock({ pageId, content: 'L2', parentId: level1.id })
    const level3 = await store.createBlock({ pageId, content: 'L3', parentId: level2.id })
    const next = await store.createBlock({ pageId, content: 'Next' })

    // 将 level1 折叠 → 合并目标应在 level1 停下
    await store.updateBlockFormat(level1.id, { collapsed: true })

    const result = await store.mergeWithPrevious(next.id)

    expect(result).toBeDefined()
    expect(result!.id).toBe(level1.id) // 折叠层 = 最后可见节点
    expect(result!.cursorPos).toBe(3) // 'L1'.length + 1
    expect(store.blocks.find(b => b.id === level1.id)?.content).toBe('L1Next')
    // level2, level3 仍然存在
    expect(store.blocks.find(b => b.id === level2.id)).toBeDefined()
    expect(store.blocks.find(b => b.id === level3.id)).toBeDefined()
  })

  // ── 边缘情况 ─────────────────────────────────────────────────────

  test('空内容 Block 合并', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const first = await store.createBlock({ pageId, content: '' })
    const second = await store.createBlock({ pageId, content: 'Hello' })

    const result = await store.mergeWithPrevious(second.id)

    expect(result).toBeDefined()
    expect(result!.cursorPos).toBe(1) // 空文本后，光标在位置 1
    expect(store.blocks.find(b => b.id === first.id)?.content).toBe('Hello')
  })

  test('合并到空 Block', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const first = await store.createBlock({ pageId, content: 'Hello' })
    const second = await store.createBlock({ pageId, content: '' })

    const result = await store.mergeWithPrevious(second.id)

    expect(result).toBeDefined()
    expect(result!.id).toBe(first.id)
    expect(result!.cursorPos).toBe(6) // 'Hello'.length + 1
    expect(store.blocks.find(b => b.id === first.id)?.content).toBe('Hello')
  })

  test('仅有单个字符的 Block 合并', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const first = await store.createBlock({ pageId, content: 'A' })
    const second = await store.createBlock({ pageId, content: 'B' })

    const result = await store.mergeWithPrevious(second.id)

    expect(result!.cursorPos).toBe(2)
    expect(store.blocks.find(b => b.id === first.id)?.content).toBe('AB')
  })

  test('当前 Block 有子节点时合并 → 子节点随父节点一起删除', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const first = await store.createBlock({ pageId, content: 'A' })
    const second = await store.createBlock({ pageId, content: 'B' })
    const secondChild = await store.createBlock({ pageId, content: 'BC', parentId: second.id })

    const result = await store.mergeWithPrevious(second.id)

    expect(result!.id).toBe(first.id)
    expect(store.blocks.find(b => b.id === second.id)).toBeUndefined()
    expect(store.blocks.find(b => b.id === secondChild.id)).toBeUndefined()
  })

  test('合并后 format 保留（目标 Block 的格式不变）', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const first = await store.createBlock({ pageId, content: 'A', format: { bold: true } })
    const second = await store.createBlock({ pageId, content: 'B', format: { italic: true } })

    const result = await store.mergeWithPrevious(second.id)

    expect(result!.id).toBe(first.id)
    const merged = store.blocks.find(b => b.id === first.id)
    expect(merged?.format.bold).toBe(true) // 目标 format 保留
  })

  test('嵌套折叠/展开混合结构', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    // 结构：root → l1(展开) → l2a(折叠，有子 l3) + l2b(展开，有子 l4)
    const root = await store.createBlock({ pageId, content: 'Root' })
    const l1 = await store.createBlock({ pageId, content: 'L1', parentId: root.id })
    const l2a = await store.createBlock({ pageId, content: 'L2A', parentId: l1.id })
    const l2b = await store.createBlock({ pageId, content: 'L2B', parentId: l1.id })
    await store.createBlock({ pageId, content: 'L3', parentId: l2a.id })
    const l4 = await store.createBlock({ pageId, content: 'L4', parentId: l2b.id })
    const next = await store.createBlock({ pageId, content: 'Next' })

    // l2a 折叠，l2b 展开
    await store.updateBlockFormat(l2a.id, { collapsed: true })

    const result = await store.mergeWithPrevious(next.id)

    // root(展开) → l1(展开) → l2a(折叠) + l2b(展开) → l4
    // 最后可见后代是 l4
    expect(result!.id).toBe(l4.id)
    expect(result!.cursorPos).toBe(3) // 'L4'.length + 1
    expect(store.blocks.find(b => b.id === l4.id)?.content).toBe('L4Next')
  })

  test('光标位置准确性：合并后光标在原内容末尾', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const first = await store.createBlock({ pageId, content: '你好世界' })
    const second = await store.createBlock({ pageId, content: '测试' })

    const result = await store.mergeWithPrevious(second.id)

    expect(result!.cursorPos).toBe(5) // 4 + 1
    expect(store.blocks.find(b => b.id === first.id)?.content).toBe('你好世界测试')
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
