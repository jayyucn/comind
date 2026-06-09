import { describe, test, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { setActivePinia, createPinia } from 'pinia'
import { useBlockStore } from '../stores/blocks'
import { usePageStore } from '../stores/pages'
import { useBlockRelationshipCleanup } from './useBlockRelationshipCleanup'
import { useRelationshipTypes } from './useRelationshipTypes'
import { db } from '../storage/db'

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
  // 初始化关系类型数据
  await db.relationshipTypes.clear()
  const { _resetForTest, load } = useRelationshipTypes()
  _resetForTest()
  await load()
})

/**
 * 测试夹具：创建两个有 title 的 page（"P" 和 "X"），分别作为「本页面」和「目标页面」。
 * 返回真实的 pageId 供后续 block 创建。
 */
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

      // 主页 block：纯 [[X]] 链接
      const block = await blockStore.createBlock({ pageId: ourPage.id, content: 'see [[X]]' })
      // 目标页 block：含反向 typed-link
      const targetBlock = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'reverse [[P]]^(required-by)'
      })

      const result = await cleanup.cleanupAfterDelete(ourPage.id, [block.id])

      expect(result.orphanedTargets).toEqual([])
      // 目标页 block 不应被修改
      const after = blockStore.blocks.find(b => b.id === targetBlock.id)
      expect(after?.content).toBe('reverse [[P]]^(required-by)')
    })

    test('被删 block 仅含单向 ^(depends-on)（无 inverse）时不应触发跨页清理', async () => {
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage, targetPage } = await createPagesWithTitles()

      // 主页 block：单向 depends-on（inverseRelationshipType 为 null）
      const block = await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'see [[X]]^(depends-on)'
      })
      const targetBlock = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'reverse [[P]]^(required-by)'
      })

      const result = await cleanup.cleanupAfterDelete(ourPage.id, [block.id])

      expect(result.orphanedTargets).toEqual([])
      const after = blockStore.blocks.find(b => b.id === targetBlock.id)
      expect(after?.content).toBe('reverse [[P]]^(required-by)')
    })

    test('被删 block 含双向 ^(depends-on<->required-by) 时应跨页降级反向引用', async () => {
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage, targetPage } = await createPagesWithTitles()

      // 主页 block：双向 typed-link
      const block = await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'see [[X]]^(depends-on<->required-by)'
      })
      // 目标页 block：含反向 required-by typed-link
      const targetBlock = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'see [[P]]^(required-by)'
      })

      const result = await cleanup.cleanupAfterDelete(ourPage.id, [block.id])

      expect(result.orphanedTargets).toEqual([
        { targetTitle: 'X', inverseType: 'required-by' }
      ])
      // 目标页 block 应被降级
      const after = blockStore.blocks.find(b => b.id === targetBlock.id)
      expect(after?.content).toBe('see [[P]]')
    })

    test('被删 block 含 auto-inverse ^(depends-on!) 时也应跨页降级', async () => {
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage, targetPage } = await createPagesWithTitles()

      const block = await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'see [[X]]^(depends-on!)'
      })
      const targetBlock = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'see [[P]]^(required-by)'
      })

      await cleanup.cleanupAfterDelete(ourPage.id, [block.id])

      const after = blockStore.blocks.find(b => b.id === targetBlock.id)
      expect(after?.content).toBe('see [[P]]')
    })

    test('同页 SURVIVING block 仍含 typed-link 到目标 X 时不应触发跨页清理', async () => {
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage, targetPage } = await createPagesWithTitles()

      // 主页：两个 block 都引用 X，第一个被删
      const block1 = await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'see [[X]]^(depends-on<->required-by)'
      })
      await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'also see [[X]]^(depends-on<->required-by)'
      })
      const targetBlock = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'see [[P]]^(required-by)'
      })

      const result = await cleanup.cleanupAfterDelete(ourPage.id, [block1.id])

      expect(result.orphanedTargets).toEqual([])
      // 目标页 block 不应被修改（因为本页还有 typed-link 维持）
      const after = blockStore.blocks.find(b => b.id === targetBlock.id)
      expect(after?.content).toBe('see [[P]]^(required-by)')
    })

    test('同页 SURVIVING block 仅含纯 [[X]]（无 ^(...)）时应触发跨页清理', async () => {
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage, targetPage } = await createPagesWithTitles()

      // 主页：一个 typed block 被删，一个纯 [[X]] block 存活
      const block1 = await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'see [[X]]^(depends-on<->required-by)'
      })
      await blockStore.createBlock({ pageId: ourPage.id, content: 'plain [[X]]' })
      const targetBlock = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'see [[P]]^(required-by)'
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
        content: 'see [[X]]^(depends-on<->required-by)'
      })
      const targetBlock1 = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'see [[P]]^(required-by)'
      })
      const targetBlock2 = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'also see [[P]]^(required-by) and more'
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
        content: 'see [[X]]^(depends-on<->required-by)'
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
        content: 'see [[X]]^(depends-on<->required-by)'
      })
      const targetBlock = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'see [[P]]^(required-by)'
      })

      const updateSpy = vi.spyOn(blockStore, 'updateBlockContent')
      await cleanup.cleanupAfterDelete(ourPage.id, [block.id])

      expect(updateSpy).toHaveBeenCalledWith(targetBlock.id, 'see [[P]]')
    })

    test('多选删除多个 block 时应去重目标集合', async () => {
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage, targetPage } = await createPagesWithTitles()

      // 两个被删 block 都引用同一目标 X
      const block1 = await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'see [[X]]^(depends-on<->required-by)'
      })
      const block2 = await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'also see [[X]]^(depends-on<->required-by)'
      })
      const targetBlock = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'see [[P]]^(required-by)'
      })

      const result = await cleanup.cleanupAfterDelete(ourPage.id, [block1.id, block2.id])

      // 目标去重：只有 1 个
      expect(result.orphanedTargets.length).toBe(1)
      // 目标页 block 应被降级
      const after = blockStore.blocks.find(b => b.id === targetBlock.id)
      expect(after?.content).toBe('see [[P]]')
    })

    test('显式传入 blocksBeforeDelete 时应使用传入的快照而非当前状态', async () => {
      // 此测试验证 commit 3ddb24a 的修复：
      // cleanupAfterDelete 使用 blocksBeforeDelete 快照进行生存检查，而非删除后的状态
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage, targetPage } = await createPagesWithTitles()

      // 创建初始 block
      const block1 = await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'see [[X]]^(depends-on<->required-by)'
      })
      // survivingBlock 存在快照中用于检查，但在断言中不需要直接引用
      void await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'keep [[X]]^(depends-on<->required-by)'
      })
      const targetBlock = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'see [[P]]^(required-by)'
      })

      // 获取删除前的 blocks 快照（包含 block1 和 survivingBlock）
      const blocksSnapshot = [...blockStore.blocks]

      // 模拟外部已删除 block1 的情况（删除后再检查会导致 survivingBlock 也消失）
      // 传入 blocksSnapshot 作为删除前的快照
      const result = await cleanup.cleanupAfterDelete(
        ourPage.id,
        [block1.id],
        blocksSnapshot
      )

      // 关键断言：因为 survivingBlock 仍含 typed-link 到 X，不应触发跨页清理
      expect(result.orphanedTargets).toEqual([])
      // 目标页 block 不应被修改
      const after = blockStore.blocks.find(b => b.id === targetBlock.id)
      expect(after?.content).toBe('see [[P]]^(required-by)')
    })

    test('blocksBeforeDelete 快照比当前状态更完整时应正确识别 surviving blocks', async () => {
      // 测试边界情况：快照包含已删除 block 的信息，但当前 blocks 已不包含
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage, targetPage } = await createPagesWithTitles()

      // 创建两个引用 X 的 block
      const block1 = await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'first [[X]]^(depends-on<->required-by)'
      })
      // block2 存在快照中用于检查，但在断言中不需要直接引用
      void await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'second [[X]]^(depends-on<->required-by)'
      })
      const targetBlock = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'see [[P]]^(required-by)'
      })

      // 模拟只删除 block1，保留 block2
      // 传入快照时，只传 block1 作为被删的
      const blocksSnapshot = [...blockStore.blocks]

      // 删除 block1（但 block2 还在）
      await blockStore.deleteBlock(block1.id)

      // 使用快照调用 cleanup，此时 block1 已不在当前 blocks 中
      // 但快照包含 block1，所以能正确识别 block2 仍在
      const result = await cleanup.cleanupAfterDelete(
        ourPage.id,
        [block1.id],
        blocksSnapshot
      )

      // 因为快照中 block2 仍含 typed-link 到 X，不应触发跨页清理
      expect(result.orphanedTargets).toEqual([])
      const after = blockStore.blocks.find(b => b.id === targetBlock.id)
      expect(after?.content).toBe('see [[P]]^(required-by)')
    })
  })
})
