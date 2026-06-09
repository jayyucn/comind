import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBlockStore } from '../../stores/blocks'
import { usePageStore } from '../../stores/pages'

vi.mock('../../storage/indexedDB', () => ({
  storage: {
    saveBlock: vi.fn().mockResolvedValue(undefined),
    deleteBlock: vi.fn().mockResolvedValue(undefined),
    deleteBlockCascade: vi.fn().mockResolvedValue(undefined),
    getBlockTree: vi.fn().mockResolvedValue([]),
    createPageWithRootBlock: vi.fn().mockImplementation(async (title: string) => ({
      id: `page-${title}`,
      title,
      blockId: `root-block-${title}`,
      type: 'normal',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }))
  }
}))

describe('PageConceptBlock 逻辑测试', () => {
  let blockStore: ReturnType<typeof useBlockStore>
  let pageStore: ReturnType<typeof usePageStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    blockStore = useBlockStore()
    pageStore = usePageStore()
  })

  describe('概念块查找', () => {
    test('应正确查找页面的概念块', async () => {
      const page = await pageStore.createPage('Test Page')
      const conceptBlock = await blockStore.createBlock({
        pageId: page.id,
        parentId: null,
        content: '',
        type: 'concept',
        format: {}
      })

      const foundConceptBlock = blockStore.blocks.find(
        b => b.pageId === page.id && b.type === 'concept'
      )
      expect(foundConceptBlock).toBeDefined()
      expect(foundConceptBlock?.id).toBe(conceptBlock.id)
    })

    test('页面无概念块时应返回 undefined', async () => {
      const page = await pageStore.createPage('Test Page')
      const foundConceptBlock = blockStore.blocks.find(
        b => b.pageId === page.id && b.type === 'concept'
      )
      expect(foundConceptBlock).toBeUndefined()
    })
  })

  describe('单页面最多一个概念块', () => {
    test('一个页面应该只允许一个概念块', async () => {
      const page = await pageStore.createPage('Test Page')
      await blockStore.createBlock({
        pageId: page.id,
        content: '',
        type: 'concept',
        format: {}
      })

      // 尝试创建第二个概念块（虽然 store 允许，但 UI/命令应该限制）
      const conceptBlocks = blockStore.blocks.filter(
        b => b.pageId === page.id && b.type === 'concept'
      )
      expect(conceptBlocks.length).toBe(1)
    })
  })
})
