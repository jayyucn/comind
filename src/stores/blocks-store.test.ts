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

describe('structureVersion', () => {
  test('increments after createBlock', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'
    const initialVersion = store.structureVersion

    await store.createBlock({ pageId, content: 'New Block' })

    expect(store.structureVersion).toBe(initialVersion + 1)
  })

  test('increments after deleteBlock', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'
    const block = await store.createBlock({ pageId, content: 'Block' })
    const versionAfterCreate = store.structureVersion

    await store.deleteBlock(block.id)

    expect(store.structureVersion).toBe(versionAfterCreate + 1)
  })

  test('increments after indent', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'
    const parent = await store.createBlock({ pageId, content: 'Parent' })
    await store.createBlock({ pageId, content: 'Child1', parentId: parent.id })
    const child2 = await store.createBlock({ pageId, content: 'Child2', parentId: parent.id })
    const versionBefore = store.structureVersion

    await store.indent(child2.id)

    expect(store.structureVersion).toBeGreaterThan(versionBefore)
  })

  test('increments after outdent', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'
    const parent = await store.createBlock({ pageId, content: 'Parent' })
    const child = await store.createBlock({ pageId, content: 'Child', parentId: parent.id })
    const versionBefore = store.structureVersion

    await store.outdent(child.id)

    expect(store.structureVersion).toBeGreaterThan(versionBefore)
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
