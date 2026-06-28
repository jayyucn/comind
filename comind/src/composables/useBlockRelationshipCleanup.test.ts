import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBlockStore } from '../stores/blocks'
import { usePageStore } from '../stores/pages'
import { useBlockRelationshipCleanup } from './useBlockRelationshipCleanup'
import { useRelationshipTypes } from './useRelationshipTypes'
import { getCore } from '../core'

vi.mock('../storage/indexedDB', () => ({
  storage: {
    saveBlock: vi.fn(),
    deleteBlock: vi.fn(),
    deleteBlockCascade: vi.fn(),
    updateBlock: vi.fn(),
    getBlockTree: vi.fn().mockResolvedValue([]),
    createPageWithRootBlock: vi.fn().mockImplementation(async (title: string, type: 'normal' | 'journal' = 'normal') => ({
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

beforeEach(async () => {
  setActivePinia(createPinia())
  await getCore().storage.relationshipTypes.findAll().then(result => 
    Promise.all(result.items.map(r => getCore().storage.relationshipTypes.delete(r.id)))
  )
  const { _resetForTest, load } = useRelationshipTypes()
  _resetForTest()
  await load()
})

async function createPagesWithTitles() {
  const pageStore = usePageStore()
  await pageStore.createPage('P', 'normal')
  const ourPage = pageStore.pages[pageStore.pages.length - 1]
  await pageStore.createPage('X', 'normal')
  const targetPage = pageStore.pages[pageStore.pages.length - 1]
  return { ourPage, targetPage }
}

describe('useBlockRelationshipCleanup', () => {
  let blockStore: ReturnType<typeof useBlockStore>

  beforeEach(() => {
    blockStore = useBlockStore()
  })

  describe('cleanupAfterDelete', () => {
    test('空 deletedBlockIds 时应立即返回且不调 deleteBlock', async () => {
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage } = await createPagesWithTitles()

      const result = await cleanup.cleanupAfterDelete(ourPage.id, [])

      expect(result.modifiedCrossPageBlocks).toEqual([])
      expect(result.orphanedTargets).toEqual([])
      expect(blockStore.blocks.length).toBe(0)
    })

    test('被删 block 无 typed-link 时不应触发跨页清理', async () => {
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage, targetPage } = await createPagesWithTitles()

      const block = await blockStore.createBlock({ pageId: ourPage.id, content: 'see [[X]]' })
      const targetBlock = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'reverse ((required-by))[[P]]'
      })

      const result = await cleanup.cleanupAfterDelete(ourPage.id, [block.id])

      expect(result.orphanedTargets).toEqual([])
      const after = blockStore.blocks.find(b => b.id === targetBlock.id)
      expect(after?.content).toBe('reverse ((required-by))[[P]]')
    })

    test('被删 block 仅含单向 ((depends-on))[[X]]（无 inverse）时不应触发跨页清理', async () => {
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage, targetPage } = await createPagesWithTitles()

      const block = await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'see ((depends-on))[[X]]'
      })
      const targetBlock = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'reverse ((required-by))[[P]]'
      })

      const result = await cleanup.cleanupAfterDelete(ourPage.id, [block.id])

      expect(result.orphanedTargets).toEqual([])
      const after = blockStore.blocks.find(b => b.id === targetBlock.id)
      expect(after?.content).toBe('reverse ((required-by))[[P]]')
    })

    test('被删 block 含双向 ((depends-on<->required-by))[[X]] 时应跨页降级反向引用', async () => {
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage, targetPage } = await createPagesWithTitles()

      const block = await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'see ((depends-on<->required-by))[[X]]'
      })
      const targetBlock = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'see ((required-by))[[P]]'
      })

      const result = await cleanup.cleanupAfterDelete(ourPage.id, [block.id])

      expect(result.orphanedTargets).toEqual([
        { targetTitle: 'X', inverseType: 'required-by' }
      ])
      const after = blockStore.blocks.find(b => b.id === targetBlock.id)
      expect(after?.content).toBe('see [[P]]')
    })

    test('被删 block 含 auto-inverse ((depends-on!))[[X]] 时也应跨页降级', async () => {
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage, targetPage } = await createPagesWithTitles()

      const block = await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'see ((depends-on!))[[X]]'
      })
      const targetBlock = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'see ((required-by))[[P]]'
      })

      await cleanup.cleanupAfterDelete(ourPage.id, [block.id])

      const after = blockStore.blocks.find(b => b.id === targetBlock.id)
      expect(after?.content).toBe('see [[P]]')
    })

    test('同页 SURVIVING block 仍含 typed-link 到目标 X 时不应触发跨页清理', async () => {
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage, targetPage } = await createPagesWithTitles()

      const block1 = await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'see ((depends-on<->required-by))[[X]]'
      })
      await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'also see ((depends-on<->required-by))[[X]]'
      })
      const targetBlock = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'see ((required-by))[[P]]'
      })

      const result = await cleanup.cleanupAfterDelete(ourPage.id, [block1.id])

      expect(result.orphanedTargets).toEqual([])
      const after = blockStore.blocks.find(b => b.id === targetBlock.id)
      expect(after?.content).toBe('see ((required-by))[[P]]')
    })

    test('同页 SURVIVING block 仅含纯 [[X]]（无 ((type))）时应触发跨页清理', async () => {
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage, targetPage } = await createPagesWithTitles()

      const block1 = await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'see ((depends-on<->required-by))[[X]]'
      })
      await blockStore.createBlock({ pageId: ourPage.id, content: 'plain [[X]]' })
      const targetBlock = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'see ((required-by))[[P]]'
      })

      await cleanup.cleanupAfterDelete(ourPage.id, [block1.id])

      const after = blockStore.blocks.find(b => b.id === targetBlock.id)
      expect(after?.content).toBe('see [[P]]')
    })

    test('目标页有多个 block 含反向引用时应全部降级', async () => {
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage, targetPage } = await createPagesWithTitles()

      const block = await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'see ((depends-on<->required-by))[[X]]'
      })
      const targetBlock1 = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'see ((required-by))[[P]]'
      })
      const targetBlock2 = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'also see ((required-by))[[P]] and more'
      })

      const result = await cleanup.cleanupAfterDelete(ourPage.id, [block.id])

      expect(result.modifiedCrossPageBlocks.length).toBe(2)
      const after1 = blockStore.blocks.find(b => b.id === targetBlock1.id)
      const after2 = blockStore.blocks.find(b => b.id === targetBlock2.id)
      expect(after1?.content).toBe('see [[P]]')
      expect(after2?.content).toBe('also see [[P]] and more')
    })

    test('目标页无反向引用时应返回空 modifiedCrossPageBlocks', async () => {
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage, targetPage } = await createPagesWithTitles()

      const block = await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'see ((depends-on<->required-by))[[X]]'
      })
      await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'plain text without any link'
      })

      const result = await cleanup.cleanupAfterDelete(ourPage.id, [block.id])

      expect(result.orphanedTargets.length).toBe(1)
      expect(result.modifiedCrossPageBlocks).toEqual([])
    })

    test('应通过 updateBlockContent 持久化被修改的跨页 block', async () => {
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage, targetPage } = await createPagesWithTitles()

      const block = await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'see ((depends-on<->required-by))[[X]]'
      })
      const targetBlock = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'see ((required-by))[[P]]'
      })

      const updateSpy = vi.spyOn(blockStore, 'updateBlockContent')
      await cleanup.cleanupAfterDelete(ourPage.id, [block.id])

      expect(updateSpy).toHaveBeenCalledWith(targetBlock.id, 'see [[P]]')
    })

    test('多选删除多个 block 时应去重目标集合', async () => {
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage, targetPage } = await createPagesWithTitles()

      const block1 = await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'see ((depends-on<->required-by))[[X]]'
      })
      const block2 = await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'also see ((depends-on<->required-by))[[X]]'
      })
      const targetBlock = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'see ((required-by))[[P]]'
      })

      const result = await cleanup.cleanupAfterDelete(ourPage.id, [block1.id, block2.id])

      expect(result.orphanedTargets.length).toBe(1)
      const after = blockStore.blocks.find(b => b.id === targetBlock.id)
      expect(after?.content).toBe('see [[P]]')
    })

    test('显式传入 blocksBeforeDelete 时应使用传入的快照而非当前状态', async () => {
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage, targetPage } = await createPagesWithTitles()

      const block1 = await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'see ((depends-on<->required-by))[[X]]'
      })
      void await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'keep ((depends-on<->required-by))[[X]]'
      })
      const targetBlock = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'see ((required-by))[[P]]'
      })

      const blocksSnapshot = [...blockStore.blocks]

      const result = await cleanup.cleanupAfterDelete(
        ourPage.id,
        [block1.id],
        blocksSnapshot
      )

      expect(result.orphanedTargets).toEqual([])
      const after = blockStore.blocks.find(b => b.id === targetBlock.id)
      expect(after?.content).toBe('see ((required-by))[[P]]')
    })

    test('blocksBeforeDelete 快照比当前状态更完整时应正确识别 surviving blocks', async () => {
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage, targetPage } = await createPagesWithTitles()

      const block1 = await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'first ((depends-on<->required-by))[[X]]'
      })
      void await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'second ((depends-on<->required-by))[[X]]'
      })
      const targetBlock = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'see ((required-by))[[P]]'
      })

      const blocksSnapshot = [...blockStore.blocks]

      await blockStore.deleteBlock(block1.id)

      const result = await cleanup.cleanupAfterDelete(
        ourPage.id,
        [block1.id],
        blocksSnapshot
      )

      expect(result.orphanedTargets).toEqual([])
      const after = blockStore.blocks.find(b => b.id === targetBlock.id)
      expect(after?.content).toBe('see ((required-by))[[P]]')
    })
  })
})
