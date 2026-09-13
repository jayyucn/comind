import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBlockStore } from '../stores/blocks'
import { usePageStore } from '../stores/pages'
import { useBlockRelationshipCleanup } from './useBlockRelationshipCleanup'
import { useRelationshipTypes } from './useRelationshipTypes'
import { cleanupRelationshipTypes } from '../../tests/core-client'

// 4.3: Mock wasm/client (getCoreClient) so cleanupAfterDelete works in Vitest (no Tauri runtime).
// These lightweight re-implementations match Rust ContentParseService behaviour.
vi.mock('../wasm/client', () => {
  function extractLinks(content: string) {
    const results: any[] = []
    const covered = new Set<number>()
    // external
    for (const m of content.matchAll(/\[\[(https?:\/\/|ftp:\/\/|mailto:)([^\]]*)\]\]/g)) {
      results.push({
        target_title: (m[1] + (m[2] || '')).trim(), display_text: (m[1] + (m[2] || '')).trim(),
        position: m.index!, is_external: true, relationship_type: null, inverse_relationship_type: null
      })
      if (m.index !== undefined) for (let i = m.index; i < m.index + m[0].length; i++) covered.add(i)
    }
    // typed
    for (const m of content.matchAll(/\(\(([^)]+)\)\)\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g)) {
      const target = m[2].trim()
      if (/^https?:\/\/|ftp:\/\/|mailto:/.test(target)) continue
      let relType: string | null = null, invType: string | null = null
      const part = m[1].trim()
      const bi = part.match(/^(.+)<->(.+)$/)
      if (bi) { relType = bi[1].trim(); invType = bi[2].trim() }
      else if (part.endsWith('!')) { relType = part.slice(0, -1).trim() }
      else { relType = part }
      results.push({
        target_title: target, display_text: (m[3] || target).trim(), position: m.index!,
        is_external: false, relationship_type: relType, inverse_relationship_type: invType
      })
      if (m.index !== undefined) for (let i = m.index; i < m.index + m[0].length; i++) covered.add(i)
    }
    // plain internal
    for (const m of content.matchAll(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g)) {
      const target = m[1].trim()
      if (/^https?:\/\/|ftp:\/\/|mailto:/.test(target)) continue
      if (m.index !== undefined && covered.has(m.index)) continue
      results.push({
        target_title: target, display_text: (m[2] || target).trim(), position: m.index!,
        is_external: false, relationship_type: null, inverse_relationship_type: null
      })
    }
    results.sort((a, b) => a.position - b.position)
    return results
  }
  function applyRel(content: string, targetTitle: string, newType: string | null) {
    const esc = targetTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    let r = content.replace(
      new RegExp(`\\(\\(([^)]+)\\)\\)\\[\\[(${esc})(?:\\|[^\\]]+?)?\\]\\]`, 'g'),
      (_, __, title) => newType === null ? `[[${title}]]` : `((${newType}))[[${title}]]`
    )
    if (newType !== null) {
      r = r.replace(
        new RegExp(`(?<!\\(\\([^)]+\\)\\))\\[\\[(${esc})(?:\\|[^\\]]+?)?\\]\\]`, 'g'),
        (_, title) => `((${newType}))[[${title}]]`
      )
    }
    return r
  }
  // 共享 mock client：getCoreClient 与 initCoreClient 必须同源，否则
  // useRelationshipTypes.load()（走 initCoreClient）拿到空对象，本文件 beforeEach 全体抛错
  const mockClient = {
    extractLinksFromContent: (c: string) => Promise.resolve(extractLinks(c)),
    applyRelationshipTypeToBlockContent: (c: string, t: string, r: string | null) => Promise.resolve(applyRel(c, t, r)),
    getDateRefsByPage: () => Promise.resolve([]),
    getDateRefsByBlock: () => Promise.resolve([]),
    getPageWithBlocks: () => Promise.resolve({ page: null, blocks: [] }),
    checkHasTypedLinkToTarget: () => Promise.resolve({ has_typed_link: false }),
    getBacklinks: () => Promise.resolve([]),
    getOutlinks: () => Promise.resolve([]),
    // useRelationshipTypes.load() 自 registry 化后需要以下原语；缺失会让本文件
    // beforeEach 全体抛错（整个文件曾因此沦为死测试，2026-09-14 补全时发现）
    getRelationshipTypes: () => Promise.resolve([]),
    executeBatch: () => Promise.resolve([]),
    // pages/blocks store 迁到 client 后 createPage/createBlock 链路所需
    savePage: (input: { title: string; type?: string }) =>
      Promise.resolve({
        id: `page-${input.title}-${Math.random().toString(36).slice(2, 8)}`,
        block_id: null,
        title: input.title,
        type: input.type ?? 'normal',
        icon: null,
        cover: null,
        aliases: '[]',
        file_path: null,
        children_count: 0,
        word_count: 0,
        created_at: Date.now(),
        updated_at: Date.now(),
        deleted: 0,
      }),
    getAllPages: () => Promise.resolve([]),
    getTrashPages: () => Promise.resolve([]),
    getBlocksByPage: () => Promise.resolve([]),
    getPagesWithBlocks: () => Promise.resolve([]),
    saveBlockTree: () => Promise.resolve([]),
    deletePageCascade: () => Promise.resolve([]),
  }
  return {
    initCoreClient: vi.fn(async () => mockClient as never),
    getCoreClient: () => mockClient,
  }
})

vi.mock('../storage/indexedDB', () => ({
  storage: {
    saveBlock: vi.fn(),
    deleteBlock: vi.fn(),
    deleteBlockCascade: vi.fn(),
    updateBlock: vi.fn(),
    getBlockTree: vi.fn().mockResolvedValue([]),
    createPageWithRootBlock: vi.fn().mockImplementation(async (title: string, type: 'normal' | 'ideas' = 'normal') => ({
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
  await cleanupRelationshipTypes()
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

    test('被删 block 含 auto-inverse ((depends-on!))[[X]] 时不应触发跨页清理（现状语义）', async () => {
      // 注意：auto-inverse 的 inverse_relationship_type 在 Rust 解析层即 None
      // （content_parse_service.rs:428 "auto-inverse resolved elsewhere"），而渲染层的
      // `!` 处理只做样式反查、不回填解析结果——cleanup 对 inverse=null 一律跳过。
      // 「auto-inverse 参与清理」从未实现过，旧断言期望降级属过期期望（2026-09-14 修正）。
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

      const result = await cleanup.cleanupAfterDelete(ourPage.id, [block.id])

      expect(result.orphanedTargets).toEqual([])
      const after = blockStore.blocks.find(b => b.id === targetBlock.id)
      expect(after?.content).toBe('see ((required-by))[[P]]')
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

  // ============================================================
  // cleanupAfterDelete - 内容级操作计划（#100 grill-up 锚定）
  // 判定口径 = 操作后本页 typed-link 存留：vanishedFragments 参与目标提取、
  // contentAfter 作为存活块的裁后内容、removedBlockIds 从存活检查排除。
  // ============================================================
  describe('cleanupAfterDelete - 内容级操作计划（#100）', () => {
    test('same-block 切片：deletedBlockIds 为空，片段里的唯一 inverse link 也降级', async () => {
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage, targetPage } = await createPagesWithTitles()

      const block = await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'see ((depends-on<->required-by))[[X]] now'
      })
      const targetBlock = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'see ((required-by))[[P]]'
      })

      // same-block 切片：链接整段被裁掉，块存活且裁后不含链接（无整块删除）
      const result = await cleanup.cleanupAfterDelete(ourPage.id, [], undefined, {
        vanishedFragments: [{ blockId: block.id, text: '((depends-on<->required-by))[[X]]' }],
        contentAfter: { [block.id]: 'see  now' },
      })

      expect(result.orphanedTargets).toEqual([{ targetTitle: 'X', inverseType: 'required-by' }])
      const after = blockStore.blocks.find(b => b.id === targetBlock.id)
      expect(after?.content).toBe('see [[P]]')
    })

    test('contentAfter 仍有 typed-link 维持时不降级（裁后内容参与存活判定）', async () => {
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage, targetPage } = await createPagesWithTitles()

      const block = await blockStore.createBlock({
        pageId: ourPage.id,
        content: '((a<->b))[[X]] keep ((c<->d))[[X]]'
      })
      const targetBlock = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'see ((b))[[P]]'
      })

      const result = await cleanup.cleanupAfterDelete(ourPage.id, [], undefined, {
        vanishedFragments: [{ blockId: block.id, text: '((a<->b))[[X]]' }],
        contentAfter: { [block.id]: 'keep ((c<->d))[[X]]' },
      })

      expect(result.orphanedTargets).toEqual([])
      const after = blockStore.blocks.find(b => b.id === targetBlock.id)
      expect(after?.content).toBe('see ((b))[[P]]')
    })

    test('merge 形态：removedBlockIds 排除存活检查（X 降级），转移存活的关系不假降级（Y 不动）', async () => {
      const cleanup = useBlockRelationshipCleanup()
      const pageStore = usePageStore()
      const { ourPage, targetPage } = await createPagesWithTitles()
      await pageStore.createPage('Y', 'normal')
      const yPage = pageStore.pages[pageStore.pages.length - 1]

      // merge：end 块整行消失，其前缀（含 X 的 link）被裁掉，后缀（Y 的 link）转入 start
      const start = await blockStore.createBlock({ pageId: ourPage.id, content: 'head' })
      const end = await blockStore.createBlock({
        pageId: ourPage.id,
        content: '((a<->b))[[X]] ((c<->d))[[Y]]'
      })
      const xBlock = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'see ((b))[[P]]'
      })
      const yBlock = await blockStore.createBlock({
        pageId: yPage.id,
        content: 'see ((d))[[P]]'
      })

      const result = await cleanup.cleanupAfterDelete(ourPage.id, [], undefined, {
        removedBlockIds: [end.id],
        vanishedFragments: [{ blockId: end.id, text: '((a<->b))[[X]]' }],
        contentAfter: { [start.id]: 'head ((c<->d))[[Y]]' },
      })

      // X 的 link 只存在于被裁片段 → 降级；若 end 被误当存活块按整块内容算，X 会被错误维持
      expect(result.orphanedTargets).toEqual([{ targetTitle: 'X', inverseType: 'b' }])
      expect(blockStore.blocks.find(b => b.id === xBlock.id)?.content).toBe('see [[P]]')
      // Y 的 link 转移存活 → 不是清理目标（朴素「end 计入被删集」会把它假降级）
      expect(blockStore.blocks.find(b => b.id === yBlock.id)?.content).toBe('see ((d))[[P]]')
    })
  })
})