import { describe, test, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBlockStore } from './blocks'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('indent', () => {
  test('indents block to become child of previous sibling', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const parent = await store.createBlock({ pageId, content: 'Parent' })
    const child1 = await store.createBlock({ pageId, content: 'Child1', parentId: parent.id })
    const child2 = await store.createBlock({ pageId, content: 'Child2', parentId: parent.id })

    await store.indent(child2.id)

    const child2After = store.blocks.find(b => b.id === child2.id)
    expect(child2After?.parentId).toBe(child1.id)
  })

  test('indenting first child has no effect', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const parent = await store.createBlock({ pageId, content: 'Parent' })
    const child = await store.createBlock({ pageId, content: 'Child', parentId: parent.id })

    const childParentIdBefore = child.parentId

    await store.indent(child.id)

    const childAfter = store.blocks.find(b => b.id === child.id)
    expect(childAfter?.parentId).toBe(childParentIdBefore)
  })

  test('indenting non-existent block has no effect', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    await store.createBlock({ pageId, content: 'Block' })
    const initialCount = store.blocks.length

    await store.indent('non-existent-id')

    expect(store.blocks).toHaveLength(initialCount)
  })
})

describe('outdent', () => {
  test('outdents block to parent level', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const parent = await store.createBlock({ pageId, content: 'Parent' })
    const child = await store.createBlock({ pageId, content: 'Child', parentId: parent.id })
    const grandchild = await store.createBlock({ pageId, content: 'Grandchild', parentId: child.id })

    await store.outdent(grandchild.id)

    const grandchildAfter = store.blocks.find(b => b.id === grandchild.id)
    expect(grandchildAfter?.parentId).toBe(parent.id)
  })

  test('outdenting root block has no effect', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const root = await store.createBlock({ pageId, content: 'Root' })

    await store.outdent(root.id)

    const rootAfter = store.blocks.find(b => b.id === root.id)
    expect(rootAfter?.parentId).toBeNull()
  })
})

describe('findPreviousVisibleBlock', () => {
  test('returns previous sibling when it has no children', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const block1 = await store.createBlock({ pageId, content: 'Block1' })
    const block2 = await store.createBlock({ pageId, content: 'Block2' })

    const result = store.findPreviousVisibleBlock(block2.id)
    expect(result?.id).toBe(block1.id)
  })

  test('returns last visible descendant of previous sibling when it has expanded children', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const block1 = await store.createBlock({ pageId, content: 'Block1' })
    const block2 = await store.createBlock({ pageId, content: 'Block2' })
    await store.createBlock({ pageId, content: 'ChildOfBlock1', parentId: block1.id })

    const result = store.findPreviousVisibleBlock(block2.id)
    expect(result?.content).toBe('ChildOfBlock1')
  })

  test('returns parent when no previous sibling', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const parent = await store.createBlock({ pageId, content: 'Parent' })
    const child = await store.createBlock({ pageId, content: 'Child', parentId: parent.id })

    const result = store.findPreviousVisibleBlock(child.id)
    expect(result?.id).toBe(parent.id)
  })

  test('returns undefined for first root block', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const block = await store.createBlock({ pageId, content: 'First' })

    const result = store.findPreviousVisibleBlock(block.id)
    expect(result).toBeUndefined()
  })

  test('collapsed block is considered visible (returns itself)', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const block1 = await store.createBlock({ pageId, content: 'Block1' })
    const block2 = await store.createBlock({
      pageId,
      content: 'Block2',
      format: { collapsed: true }
    })
    await store.createBlock({ pageId, content: 'Child', parentId: block2.id })

    const result = store.findPreviousVisibleBlock(block2.id)
    expect(result?.id).toBe(block1.id)
  })
})

describe('findLastVisibleDescendant', () => {
  test('returns block itself when it has no children', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const block = await store.createBlock({ pageId, content: 'Block' })

    const result = store.findLastVisibleDescendant(block.id)
    expect(result?.id).toBe(block.id)
  })

  test('returns last child when block has expanded children', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const parent = await store.createBlock({ pageId, content: 'Parent' })
    const child = await store.createBlock({ pageId, content: 'Child', parentId: parent.id })
    await store.createBlock({ pageId, content: 'Grandchild', parentId: child.id })

    const result = store.findLastVisibleDescendant(parent.id)
    expect(result?.content).toBe('Grandchild')
  })

  test('returns block itself when it is collapsed', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const parent = await store.createBlock({
      pageId,
      content: 'Parent',
      format: { collapsed: true }
    })
    await store.createBlock({ pageId, content: 'Child', parentId: parent.id })

    const result = store.findLastVisibleDescendant(parent.id)
    expect(result?.id).toBe(parent.id)
  })
})

describe('findNextBlockInTreeOrder', () => {
  test('returns first child when block has children', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const parent = await store.createBlock({ pageId, content: 'Parent' })
    const child = await store.createBlock({ pageId, content: 'Child', parentId: parent.id })

    const result = store.findNextBlockInTreeOrder(parent.id)
    expect(result?.id).toBe(child.id)
  })

  test('returns next sibling when block has no children', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const block1 = await store.createBlock({ pageId, content: 'Block1' })
    const block2 = await store.createBlock({ pageId, content: 'Block2' })

    const result = store.findNextBlockInTreeOrder(block1.id)
    expect(result?.id).toBe(block2.id)
  })

  test('returns uncle sibling when no next sibling', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const block1 = await store.createBlock({ pageId, content: 'Block1' })
    const block2 = await store.createBlock({ pageId, content: 'Block2' })
    const child = await store.createBlock({ pageId, content: 'Child', parentId: block1.id })

    const result = store.findNextBlockInTreeOrder(child.id)
    expect(result?.id).toBe(block2.id)
  })

  test('returns undefined for last block', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const block = await store.createBlock({ pageId, content: 'Last' })

    const result = store.findNextBlockInTreeOrder(block.id)
    expect(result).toBeUndefined()
  })
})

describe('findPreviousBlockInTreeOrder', () => {
  test('returns previous sibling when it has no children', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const block1 = await store.createBlock({ pageId, content: 'Block1' })
    const block2 = await store.createBlock({ pageId, content: 'Block2' })

    const result = store.findPreviousBlockInTreeOrder(block2.id)
    expect(result?.id).toBe(block1.id)
  })

  test('returns last descendant of previous sibling when it has children', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const block1 = await store.createBlock({ pageId, content: 'Block1' })
    const block2 = await store.createBlock({ pageId, content: 'Block2' })
    await store.createBlock({ pageId, content: 'Child', parentId: block1.id })

    const result = store.findPreviousBlockInTreeOrder(block2.id)
    expect(result?.content).toBe('Child')
  })

  test('returns parent when no previous sibling', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const parent = await store.createBlock({ pageId, content: 'Parent' })
    const child = await store.createBlock({ pageId, content: 'Child', parentId: parent.id })

    const result = store.findPreviousBlockInTreeOrder(child.id)
    expect(result?.id).toBe(parent.id)
  })
})

describe('getBlocksByPage', () => {
  test('returns only blocks for specified page', async () => {
    const store = useBlockStore()

    await store.createBlock({ pageId: 'page-1', content: 'Block1' })
    await store.createBlock({ pageId: 'page-1', content: 'Block2' })
    await store.createBlock({ pageId: 'page-2', content: 'Block3' })

    const page1Blocks = store.getBlocksByPage('page-1')
    const page2Blocks = store.getBlocksByPage('page-2')

    expect(page1Blocks).toHaveLength(2)
    expect(page2Blocks).toHaveLength(1)
  })
})

describe('getChildren', () => {
  test('returns only direct children', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const parent = await store.createBlock({ pageId, content: 'Parent' })
    const child = await store.createBlock({ pageId, content: 'Child', parentId: parent.id })
    await store.createBlock({ pageId, content: 'Grandchild', parentId: child.id })

    const children = store.getChildren(parent.id)
    expect(children).toHaveLength(1)
    expect(children[0].id).toBe(child.id)
  })

  test('returns empty array for block with no children', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const block = await store.createBlock({ pageId, content: 'Block' })

    const children = store.getChildren(block.id)
    expect(children).toHaveLength(0)
  })
})

describe('updateBlockContent clears renderSegments', () => {
  test('clears renderSegments after content update (fixes content-disappear bug)', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    // Simulate a block loaded from Rust with pre-computed renderSegments
    const block = await store.createBlock({ pageId, content: 'Hello world' })
    // Manually set renderSegments as if loaded from loadPageBlocks
    const blockInStore = store.blocks.find(b => b.id === block.id)!
    blockInStore.renderSegments = [
      { type: 'text', start: 0, end: 11 } // matches "Hello world".length
    ]

    // Update content — new content is longer than old
    await store.updateBlockContent(block.id, 'Hello world, this is longer now')

    const updated = store.blocks.find(b => b.id === block.id)
    expect(updated?.content).toBe('Hello world, this is longer now')
    // renderSegments must be cleared — old segments have stale start/end indices
    expect(updated?.renderSegments).toBeUndefined()
  })

  test('clears renderSegments when content is set to empty', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const block = await store.createBlock({ pageId, content: 'Some content here' })
    const blockInStore = store.blocks.find(b => b.id === block.id)!
    blockInStore.renderSegments = [{ type: 'text', start: 0, end: 17 }]

    await store.updateBlockContent(block.id, '')

    const updated = store.blocks.find(b => b.id === block.id)
    expect(updated?.content).toBe('')
    expect(updated?.renderSegments).toBeUndefined()
  })

  test('clears renderSegments on mergeWithPrevious', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const block1 = await store.createBlock({ pageId, content: 'First' })
    const block2 = await store.createBlock({ pageId, content: 'Second' })

    // Simulate Rust-computed renderSegments
    const b1 = store.blocks.find(b => b.id === block1.id)!
    b1.renderSegments = [{ type: 'text', start: 0, end: 5 }]

    await store.mergeWithPrevious(block2.id)

    const merged = store.blocks.find(b => b.id === block1.id)
    expect(merged?.content).toBe('FirstSecond')
    expect(merged?.renderSegments).toBeUndefined()
  })
})

describe('deleteBlocks 不变量：每 page 始终至少保留 1 个 block', () => {
  test('删除唯一 block 时清空其内容而非消失', async () => {
    const store = useBlockStore()
    const pageId = 'inv-page-1'
    const only = await store.createBlock({ pageId, content: '唯一' })

    await store.deleteBlock(only.id)

    const remaining = store.getBlocksByPage(pageId)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe(only.id)
    expect(remaining[0].content).toBe('')
  })

  test('select-all 删除后页面恰好剩 1 个空 block（文档序最后一块）', async () => {
    const store = useBlockStore()
    const pageId = 'inv-page-2'
    const a = await store.createBlock({ pageId, content: 'A' })
    const b = await store.createBlock({ pageId, content: 'B' })
    const c = await store.createBlock({ pageId, content: 'C' })

    await store.deleteBlocks([a.id, b.id, c.id])

    const remaining = store.getBlocksByPage(pageId)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe(c.id) // 文档序最后一块被保留
    expect(remaining[0].content).toBe('')
  })

  test('级联删除含子孙的末顶层块也守不变量', async () => {
    const store = useBlockStore()
    const pageId = 'inv-page-3'
    const top = await store.createBlock({ pageId, content: 'Top' })
    const child = await store.createBlock({ pageId, content: 'Child', parentId: top.id })

    await store.deleteBlock(top.id)

    const remaining = store.getBlocksByPage(pageId)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe(top.id)
    expect(remaining[0].content).toBe('')
    // 子孙随级联删除
    expect(store.blocks.find(b => b.id === child.id)).toBeUndefined()
  })

  test('删除非末块不触发闸门（其余块保留原样）', async () => {
    const store = useBlockStore()
    const pageId = 'inv-page-4'
    const a = await store.createBlock({ pageId, content: 'A' })
    const b = await store.createBlock({ pageId, content: 'B' })

    await store.deleteBlock(a.id)

    const remaining = store.getBlocksByPage(pageId)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe(b.id)
    expect(remaining[0].content).toBe('B')
  })
})

describe('updateBlockContent 内容无变化守卫（防空转 bump updated_at）', () => {
  test('相同内容：不重打 updatedAt，flush 后依旧（整体空转）', async () => {
    const store = useBlockStore()
    const pageId = 'guard-page-1'
    const block = await store.createBlock({ pageId, content: '相同内容' })

    const memBefore = store.blocks.find(b => b.id === block.id)!.updatedAt

    // 模拟 blur/unmount 的无条件保存：内容与 store 一致 → 应整体空转
    await store.updateBlockContent(block.id, '相同内容')
    await store.flushSave(block.id)

    const memAfter = store.blocks.find(b => b.id === block.id)!
    expect(memAfter.content).toBe('相同内容')
    expect(memAfter.updatedAt).toBe(memBefore) // 未重打时间戳 → 也不会调度保存落库
  })

  test('内容实际变化：仍更新 updatedAt 并触发保存', async () => {
    const store = useBlockStore()
    const pageId = 'guard-page-2'
    const block = await store.createBlock({ pageId, content: '旧内容' })

    const memBefore = store.blocks.find(b => b.id === block.id)!.updatedAt

    await store.updateBlockContent(block.id, '新内容')
    await store.flushSave(block.id)

    const memAfter = store.blocks.find(b => b.id === block.id)!
    expect(memAfter.content).toBe('新内容')
    expect(memAfter.updatedAt).toBeGreaterThanOrEqual(memBefore)
  })
})

// ── ADR-0045 折叠语义：单一权威 + 不变量 ─────────────────────────────
describe('findNextVisibleBlock（D3：落点只能是可见块）', () => {
  test('折叠块不进入其后代，落点为下一个兄弟', async () => {
    const store = useBlockStore()
    const pageId = 'page-visible-1'

    const parent = await store.createBlock({ pageId, content: 'Parent' })
    const child = await store.createBlock({ pageId, content: 'Child', parentId: parent.id })
    const next = await store.createBlock({ pageId, content: 'Next' })

    await store.updateBlockFormat(parent.id, { collapsed: true })
    expect(store.findNextVisibleBlock(parent.id)?.id).toBe(next.id)

    // 对照组：展开后回到「进入第一个子块」的原有语义
    await store.updateBlockFormat(parent.id, { collapsed: false })
    expect(store.findNextVisibleBlock(parent.id)?.id).toBe(child.id)
  })

  test('文档末块没有下一个可见落点', async () => {
    const store = useBlockStore()
    const only = await store.createBlock({ pageId: 'page-visible-2', content: 'Only' })
    expect(store.findNextVisibleBlock(only.id)).toBeUndefined()
  })

  test('末子块上溯到祖先的兄弟', async () => {
    const store = useBlockStore()
    const pageId = 'page-visible-3'

    const parent = await store.createBlock({ pageId, content: 'Parent' })
    const child = await store.createBlock({ pageId, content: 'Child', parentId: parent.id })
    const uncle = await store.createBlock({ pageId, content: 'Uncle' })

    expect(store.findNextVisibleBlock(child.id)?.id).toBe(uncle.id)
  })
})

describe('折叠不变量对账（D2/D4）', () => {
  test('删除掏空折叠父块 ⇒ 复位 collapsed（stale 残留的根治点）', async () => {
    const store = useBlockStore()
    const pageId = 'page-reconcile-1'

    const parent = await store.createBlock({ pageId, content: 'Parent' })
    const child = await store.createBlock({ pageId, content: 'Child', parentId: parent.id })
    await store.updateBlockFormat(parent.id, { collapsed: true })

    await store.deleteBlock(child.id)

    expect(store.getBlock(parent.id)?.format?.collapsed).toBe(false)
  })

  test('缩进落入折叠父块 ⇒ 展开父块（落点 = 可见结果）', async () => {
    const store = useBlockStore()
    const pageId = 'page-reconcile-2'

    const target = await store.createBlock({ pageId, content: 'Target' })
    await store.createBlock({ pageId, content: 'Existing', parentId: target.id })
    const sibling = await store.createBlock({ pageId, content: 'Sibling' })
    await store.updateBlockFormat(target.id, { collapsed: true })

    await store.indent(sibling.id)

    expect(store.getBlock(sibling.id)?.parentId).toBe(target.id)
    expect(store.getBlock(target.id)?.format?.collapsed).toBe(false)
  })

  test('合并把子树转入折叠目标 ⇒ 展开目标', async () => {
    const store = useBlockStore()
    const pageId = 'page-reconcile-3'

    const target = await store.createBlock({ pageId, content: 'Target' })
    const source = await store.createBlock({ pageId, content: 'Source' })
    await store.createBlock({ pageId, content: 'MovedChild', parentId: source.id })
    await store.updateBlockFormat(target.id, { collapsed: true })

    await store.mergeWithPrevious(source.id)

    expect(store.getBlock(source.id)).toBeUndefined()
    expect(store.getBlock(target.id)?.format?.collapsed).toBe(false)
  })
})
