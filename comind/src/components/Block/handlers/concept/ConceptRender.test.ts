import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBlockStore } from '../../../../stores/blocks'

vi.mock('../../../../storage/indexedDB', () => ({
  storage: {
    saveBlock: vi.fn().mockResolvedValue(undefined),
    deleteBlock: vi.fn().mockResolvedValue(undefined),
    deleteBlockCascade: vi.fn().mockResolvedValue(undefined),
    getBlockTree: vi.fn().mockResolvedValue([]),
  },
}))

describe('ConceptRender Logic', () => {
  let blockStore: ReturnType<typeof useBlockStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    blockStore = useBlockStore()
  })

  test('should define concept block format fields', async () => {
    const pageId = 'page-1'
    const conceptBlock = await blockStore.createBlock({
      pageId,
      content: '',
      type: 'concept',
      format: {
        definition: '',
        boundaryExtension: '',
        boundaryForbidden: '',
        comparisonLeft: '',
        comparisonRight: '',
        exampleInstances: '',
        exampleUsage: '',
      },
    })
    expect(conceptBlock.format).toBeDefined()
    expect(conceptBlock.format.definition).toBe('')
    expect(conceptBlock.format.boundaryExtension).toBe('')
    expect(conceptBlock.format.boundaryForbidden).toBe('')
  })

  test('should store collapsed state in format.conceptCollapsed', async () => {
    const pageId = 'page-1'
    const conceptBlock = await blockStore.createBlock({
      pageId,
      content: '',
      type: 'concept',
      format: {
        conceptCollapsed: {
          definition: false,
          boundary: true,
          comparison: false,
          example: true,
        },
      },
    })
    expect(conceptBlock.format.conceptCollapsed).toBeDefined()
    expect(conceptBlock.format.conceptCollapsed.boundary).toBe(true)
    expect(conceptBlock.format.conceptCollapsed.example).toBe(true)
  })

  test('should update concept block format with updateBlockFormat', async () => {
    const pageId = 'page-1'
    const conceptBlock = await blockStore.createBlock({
      pageId,
      content: '',
      type: 'concept',
      format: { definition: 'old definition' },
    })
    blockStore.updateBlockFormat(conceptBlock.id, {
      definition: 'new definition',
      boundaryExtension: 'extension content',
    })
    const updatedBlock = blockStore.blocks.find((b) => b.id === conceptBlock.id)
    expect(updatedBlock?.format.definition).toBe('new definition')
    expect(updatedBlock?.format.boundaryExtension).toBe('extension content')
  })

  test('should register concept type in block registry', async () => {
    // 导入 concept handler 以触发注册
    await import('./index')
    const { useBlockRegistry } = await import('../../../../composables/useBlockRegistry')
    const { getHandler } = useBlockRegistry()
    const handler = getHandler('concept')
    expect(handler).toBeDefined()
    expect(handler?.type).toBe('concept')
  }, 10000)  // 增加超时时间到 10 秒
})
