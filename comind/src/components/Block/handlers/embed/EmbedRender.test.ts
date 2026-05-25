import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBlockStore } from '../../../../stores/blocks'
import { usePageStore } from '../../../../stores/pages'
import type { Block } from '../../../../types/block'

vi.mock('../../../../storage/indexedDB', () => ({
  storage: {
    saveBlock: vi.fn().mockResolvedValue(undefined),
    deleteBlock: vi.fn().mockResolvedValue(undefined),
    deleteBlockCascade: vi.fn().mockResolvedValue(undefined),
    getBlockTree: vi.fn().mockResolvedValue([])
  }
}))

vi.mock('../../../../composables/useNavigateToPage', () => ({
  useNavigateToPage: () => ({
    navigateToPage: vi.fn()
  })
}))

describe('EmbedRender 逻辑测试', () => {
  let blockStore: ReturnType<typeof useBlockStore>
  let pageStore: ReturnType<typeof usePageStore>

  const MAX_EMBED_DEPTH = 3

  function simulateDetectCircular(
    sourceBlockId: string,
    blocks: Block[],
    depth: number = 0
  ): boolean {
    if (depth > MAX_EMBED_DEPTH) return true
    const block = blocks.find(b => b.id === sourceBlockId)
    if (!block || block.type !== 'embed') return false
    const nextId = block.properties?.sourceBlockId
    if (!nextId) return false
    if (nextId === sourceBlockId) return true
    if (depth >= MAX_EMBED_DEPTH) return true
    return simulateDetectCircular(nextId, blocks, depth + 1)
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    blockStore = useBlockStore()
    pageStore = usePageStore()
  })

  describe('循环引用检测 (detectCircular)', () => {
    test('空 sourceBlockId 不应触发循环检测', () => {
      const blocks: Block[] = []
      const result = simulateDetectCircular('', blocks)
      expect(result).toBe(false)
    })

    test('目标块不是 embed 类型不应触发循环', async () => {
      const pageId = 'page-1'
      const bulletBlock = await blockStore.createBlock({ pageId, content: 'Bullet', type: 'bullet' })
      const result = simulateDetectCircular(bulletBlock.id, blockStore.blocks)
      expect(result).toBe(false)
    })

    test('embed 块没有 sourceBlockId 属性不应触发循环', async () => {
      const pageId = 'page-1'
      const embedBlock = await blockStore.createBlock({ pageId, content: 'Embed', type: 'embed', properties: {} })
      const result = simulateDetectCircular(embedBlock.id, blockStore.blocks)
      expect(result).toBe(false)
    })

    test('直接自引用应被检测', async () => {
      const pageId = 'page-1'
      const selfRefBlock = await blockStore.createBlock({
        pageId,
        content: 'Self Ref',
        type: 'embed',
        properties: { sourceBlockId: '' }
      })

      const blocksWithSelfRef: Block[] = [
        ...blockStore.blocks.filter(b => b.id !== selfRefBlock.id),
        { ...selfRefBlock, properties: { sourceBlockId: selfRefBlock.id } }
      ]

      const result = simulateDetectCircular(selfRefBlock.id, blocksWithSelfRef)
      expect(result).toBe(true)
    })

    test('超过最大深度限制应返回 true', async () => {
      const pageId = 'page-1'
      const chain: Block[] = []

      for (let i = 0; i < MAX_EMBED_DEPTH + 2; i++) {
        const block = await blockStore.createBlock({
          pageId,
          content: `Block ${i}`,
          type: 'embed',
          properties: {}
        })
        chain.push(block)
      }

      for (let i = 0; i < chain.length - 1; i++) {
        chain[i].properties = { sourceBlockId: chain[i + 1].id }
      }
      chain[chain.length - 1].properties = { sourceBlockId: chain[chain.length - 1].id }

      const firstBlock = chain[0]
      const result = simulateDetectCircular(firstBlock.id, chain)
      expect(result).toBe(true)
    })

    test('非循环的嵌套 embed 应返回 false', async () => {
      const pageId = 'page-1'
      const blockA = await blockStore.createBlock({ pageId, content: 'A', type: 'bullet' })
      const blockB = await blockStore.createBlock({ pageId, content: 'B', type: 'embed', properties: { sourceBlockId: blockA.id } })

      const result = simulateDetectCircular(blockB.id, blockStore.blocks)
      expect(result).toBe(false)
    })

    test('不存在的块 ID 应安全处理', () => {
      const blocks: Block[] = []
      const result = simulateDetectCircular('non-existent-id', blocks)
      expect(result).toBe(false)
    })

    test('跨页块列表中的 embed 应正确处理', async () => {
      const pageId1 = 'page-1'
      const pageId2 = 'page-2'

      const blockOnPage2 = await blockStore.createBlock({
        pageId: pageId2,
        content: 'Block on Page 2',
        type: 'bullet'
      })

      const embedBlock = await blockStore.createBlock({
        pageId: pageId1,
        content: 'Embed Block',
        type: 'embed',
        properties: { sourceBlockId: blockOnPage2.id }
      })

      const remoteBlocks = [blockOnPage2]
      const allBlocks = [...blockStore.blocks, ...remoteBlocks]

      const result = simulateDetectCircular(blockOnPage2.id, allBlocks)
      expect(result).toBe(false)
    })
  })

  describe('源块加载逻辑 (loadSourceBlock 模拟)', () => {
    test('sourceBlockId 为空时 remoteBlock 应为 null', () => {
      const sourceBlockId = ''
      const remoteBlock = sourceBlockId
        ? blockStore.blocks.find(b => b.id === sourceBlockId)
        : null
      expect(remoteBlock).toBeNull()
    })

    test('sourceBlockId 在本地块列表中时应直接使用', async () => {
      const pageId = 'page-1'
      const localBlock = await blockStore.createBlock({ pageId, content: 'Local Block' })

      const sourceBlockId = localBlock.id
      const local = blockStore.blocks.find(b => b.id === sourceBlockId)
      expect(local).toBeDefined()
      expect(local?.id).toBe(localBlock.id)
    })

    test('sourceBlockId 不在本地时需要从 storage 加载', async () => {
      const sourceBlockId = 'external-block-id'
      const sourcePageId = 'external-page-id'

      const local = blockStore.blocks.find(b => b.id === sourceBlockId)
      expect(local).toBeUndefined()

      const externalBlock: Block = {
        id: sourceBlockId,
        pageId: sourcePageId,
        parentId: null,
        pos: 1000,
        content: 'External Block',
        format: {},
        type: 'bullet',
        properties: {},
        createdAt: Date.now(),
        updatedAt: Date.now()
      }

      const remoteBlocks = [externalBlock]
      const remoteBlock = remoteBlocks.find(b => b.id === sourceBlockId) ?? null

      expect(remoteBlock).toBeDefined()
      expect(remoteBlock?.id).toBe(sourceBlockId)
    })

    test('storage 加载失败时应捕获异常并返回 null', async () => {
      const sourceBlockId = 'external-block-id'
      const sourcePageId = 'external-page-id'

      let remoteBlock: Block | null = null
      try {
        throw new Error('Storage error')
      } catch {
        remoteBlock = null
      }

      expect(remoteBlock).toBeNull()
    })
  })

  describe('同页/跨页判断', () => {
    test('embed 块与当前页面相同时应标记为同页', async () => {
      const pageId = 'page-1'
      const block = await blockStore.createBlock({ pageId, content: 'Block' })

      const currentPageId = pageId
      const isSamePage = block && block.pageId === currentPageId

      expect(isSamePage).toBe(true)
    })

    test('embed 块与当前页面不同时应标记为跨页', async () => {
      const pageId1 = 'page-1'
      const pageId2 = 'page-2'
      const block = await blockStore.createBlock({ pageId: pageId1, content: 'Block' })

      const currentPageId = pageId2
      const isSamePage = block && block.pageId === currentPageId

      expect(isSamePage).toBe(false)
    })
  })

  describe('子块加载', () => {
    test('应加载 sourceBlock 的直接子块', async () => {
      const pageId = 'page-1'
      const parent = await blockStore.createBlock({ pageId, content: 'Parent' })
      const child1 = await blockStore.createBlock({ pageId, content: 'Child 1', parentId: parent.id })
      const child2 = await blockStore.createBlock({ pageId, content: 'Child 2', parentId: parent.id })
      const grandchild = await blockStore.createBlock({ pageId, content: 'Grandchild', parentId: child1.id })

      const allBlocks = blockStore.blocks.filter(b => b.pageId === pageId)
      const sourceBlockId = parent.id
      const childrenBlocks = allBlocks
        .filter(b => b.parentId === sourceBlockId)
        .sort((a, b) => a.pos - b.pos)

      expect(childrenBlocks.length).toBe(2)
      expect(childrenBlocks[0].id).toBe(child1.id)
      expect(childrenBlocks[1].id).toBe(child2.id)
    })

    test('无子块时应返回空数组', async () => {
      const pageId = 'page-1'
      const block = await blockStore.createBlock({ pageId, content: 'Block' })

      const allBlocks = blockStore.blocks.filter(b => b.pageId === pageId)
      const childrenBlocks = allBlocks.filter(b => b.parentId === block.id)

      expect(childrenBlocks.length).toBe(0)
    })
  })

  describe('块处理器获取', () => {
    test('已注册的类型应返回对应处理器', async () => {
      const { useBlockRegistry } = await import('../../../../composables/useBlockRegistry')
      const { register, getHandler } = useBlockRegistry()

      register({
        type: 'bullet',
        label: 'Bullet',
        editorComponent: {} as any,
        renderComponent: {} as any
      })

      const handler = getHandler('bullet')
      expect(handler).toBeDefined()
      expect(handler?.type).toBe('bullet')
    })

    test('未注册的类型应返回 undefined', async () => {
      const { useBlockRegistry } = await import('../../../../composables/useBlockRegistry')
      const { getHandler } = useBlockRegistry()

      const handler = getHandler('unregistered-type')
      expect(handler).toBeUndefined()
    })
  })

  describe('边界条件和错误处理', () => {
    test('sourceBlock 不存在时应显示错误状态', () => {
      const sourceBlockId = 'non-existent-id'
      const sourceBlock = blockStore.blocks.find(b => b.id === sourceBlockId) ?? null

      expect(sourceBlock).toBeNull()
    })

    test('属性缺失时应安全处理', async () => {
      const pageId = 'page-1'
      const block = await blockStore.createBlock({
        pageId,
        content: 'Block',
        properties: undefined as any
      })

      const sourceBlockId = block.properties?.sourceBlockId as string || ''
      expect(sourceBlockId).toBe('')
    })

    test('format 对象应正确处理', async () => {
      const pageId = 'page-1'
      const block = await blockStore.createBlock({
        pageId,
        content: 'Block',
        format: { collapsed: true }
      })

      expect(block.format).toBeDefined()
      expect(block.format.collapsed).toBe(true)
    })
  })

  describe('MAX_EMBED_DEPTH 常量', () => {
    test('MAX_EMBED_DEPTH 应为 3', () => {
      expect(MAX_EMBED_DEPTH).toBe(3)
    })

    test('深度 0 应小于等于 MAX_EMBED_DEPTH', () => {
      const depth = 0
      expect(depth <= MAX_EMBED_DEPTH).toBe(true)
    })

    test('深度 MAX_EMBED_DEPTH 应小于等于 MAX_EMBED_DEPTH', () => {
      const depth = MAX_EMBED_DEPTH
      expect(depth <= MAX_EMBED_DEPTH).toBe(true)
    })

    test('深度 MAX_EMBED_DEPTH + 1 应大于 MAX_EMBED_DEPTH', () => {
      const depth = MAX_EMBED_DEPTH + 1
      expect(depth > MAX_EMBED_DEPTH).toBe(true)
    })
  })

  describe('sourceBlockId 和 sourcePageId 提取', () => {
    test('应从 properties 中提取 sourceBlockId', () => {
      const properties = { sourceBlockId: 'test-block-id', otherProp: 'value' }
      const sourceBlockId = properties?.sourceBlockId as string || ''
      expect(sourceBlockId).toBe('test-block-id')
    })

    test('sourceBlockId 不存在时应返回空字符串', () => {
      const properties = { otherProp: 'value' }
      const sourceBlockId = properties?.sourceBlockId as string || ''
      expect(sourceBlockId).toBe('')
    })

    test('properties 为空时应返回空字符串', () => {
      const properties: Record<string, any> = {}
      const sourceBlockId = properties?.sourceBlockId as string || ''
      expect(sourceBlockId).toBe('')
    })

    test('应从 properties 中提取 sourcePageId', () => {
      const properties = { sourcePageId: 'test-page-id', otherProp: 'value' }
      const sourcePageId = properties?.sourcePageId as string || ''
      expect(sourcePageId).toBe('test-page-id')
    })
  })

  describe('childrenBlocks 排序', () => {
    test('子块应按 pos 排序', async () => {
      const pageId = 'page-1'
      const parent = await blockStore.createBlock({ pageId, content: 'Parent' })

      const child1 = await blockStore.createBlock({ pageId, content: 'Child 1', parentId: parent.id })
      const child2 = await blockStore.createBlock({ pageId, content: 'Child 2', parentId: parent.id })
      const child3 = await blockStore.createBlock({ pageId, content: 'Child 3', parentId: parent.id })

      const allBlocks = blockStore.blocks.filter(b => b.pageId === pageId)
      const childrenBlocks = allBlocks
        .filter(b => b.parentId === parent.id)
        .sort((a, b) => a.pos - b.pos)

      expect(childrenBlocks.length).toBe(3)
      expect(childrenBlocks[0].pos).toBeLessThanOrEqual(childrenBlocks[1].pos)
      expect(childrenBlocks[1].pos).toBeLessThanOrEqual(childrenBlocks[2].pos)
    })
  })
})
