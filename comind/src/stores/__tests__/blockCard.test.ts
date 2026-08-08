import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const { mockInitCoreClient, mockGetBlockCards } = vi.hoisted(() => {
  return {
    mockGetBlockCards: vi.fn(),
    mockInitCoreClient: vi.fn(),
  }
})

vi.mock('../../wasm/client', () => {
  return {
    initCoreClient: mockInitCoreClient,
    getCoreClient: vi.fn(),
  }
})

function makeCard(overrides: Partial<import('../../wasm/types').BlockCard> = {}) {
  return {
    block_id: 'block-1',
    page_id: 'page-1',
    parent_id: 'page-1',
    content_preview: 'Test content',
    properties: {},
    date_refs: [],
    updated_at: 1000,
    ...overrides,
  }
}

function createMockClient(getBlockCardsImpl: ReturnType<typeof vi.fn>) {
  return { getBlockCards: getBlockCardsImpl }
}

describe('blockCard store', () => {
  let useBlockCardStore: typeof import('../blockCard').useBlockCardStore

  beforeEach(async () => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()

    // Re-setup mock factory after resetModules
    vi.doMock('../../wasm/client', () => ({
      initCoreClient: mockInitCoreClient,
      getCoreClient: vi.fn(),
    }))

    useBlockCardStore = (await import('../blockCard')).useBlockCardStore

    mockGetBlockCards.mockResolvedValue([])
    mockInitCoreClient.mockResolvedValue(createMockClient(mockGetBlockCards))
  })

  // ── load ──

  it('load 从 backend 获取卡片', async () => {
    const cards = [makeCard({ block_id: 'a' }), makeCard({ block_id: 'b' })]
    mockGetBlockCards.mockResolvedValue(cards)

    const store = useBlockCardStore()
    const result = await store.load()

    expect(result).toEqual(cards)
    expect(store.cards).toEqual(cards)
    expect(store.loading).toBe(false)
    expect(store.cardCount).toBe(2)
  })

  it('load 期间 loading 为 true', async () => {
    let resolveClient: ((value: any) => void) | null = null
    mockInitCoreClient.mockImplementation(
      () => new Promise(resolve => { resolveClient = resolve })
    )

    const store = useBlockCardStore()
    const loadPromise = store.load()

    // client 还未 resolve，loading 应为 true
    expect(store.loading).toBe(true)

    resolveClient!({ getBlockCards: () => Promise.resolve([makeCard()]) })
    await loadPromise

    expect(store.loading).toBe(false)
  })

  // ── invalidate + refreshIfDirty 行为组合 ──

  describe('invalidate + refreshIfDirty', () => {
    it('invalidate(blockId) 后刷新会移除该卡片', async () => {
      const cards = [
        makeCard({ block_id: 'a', content_preview: 'Keep' }),
        makeCard({ block_id: 'b', content_preview: 'Remove' }),
      ]
      mockGetBlockCards.mockResolvedValue([])

      const store = useBlockCardStore()
      store.cards = cards
      store.invalidate('b')

      await store.refreshIfDirty()

      expect(store.cards.length).toBe(1)
      expect(store.cards[0].block_id).toBe('a')
    })

    it('invalidate() 全脏时 load 刷新全部', async () => {
      const newCards = [makeCard({ block_id: 'new', content_preview: 'New data' })]
      mockGetBlockCards.mockResolvedValue(newCards)

      const store = useBlockCardStore()
      store.invalidate()

      await store.refreshIfDirty()

      expect(mockGetBlockCards).toHaveBeenCalledTimes(1)
      expect(store.cards).toEqual(newCards)
    })

    it('无 dirty 标记时 refreshIfDirty 不做任何操作', async () => {
      const cards = [makeCard({ block_id: 'a' })]
      const store = useBlockCardStore()
      store.cards = cards

      await store.refreshIfDirty()

      expect(store.cards).toEqual(cards)
      expect(mockGetBlockCards).not.toHaveBeenCalled()
    })
  })

  // ── getCards ──

  describe('getCards', () => {
    it('有缓存且无 dirty 时直接返回缓存', async () => {
      const cards = [makeCard({ block_id: 'a' })]
      const store = useBlockCardStore()
      store.cards = cards

      const result = await store.getCards()

      expect(result).toEqual(cards)
      expect(mockGetBlockCards).not.toHaveBeenCalled()
    })

    it('缓存为空时自动调用 load()', async () => {
      const cards = [makeCard({ block_id: 'a' })]
      mockGetBlockCards.mockResolvedValue(cards)

      const store = useBlockCardStore()
      const result = await store.getCards()

      expect(result).toEqual(cards)
      expect(mockGetBlockCards).toHaveBeenCalledTimes(1)
    })

    it('有 dirty 标记时先刷新再返回', async () => {
      const cards = [makeCard({ block_id: 'a' })]
      mockGetBlockCards.mockResolvedValue([makeCard({ block_id: 'b' })])

      const store = useBlockCardStore()
      store.cards = cards
      store.invalidate('a')

      const result = await store.getCards()

      expect(result).toHaveLength(1)
      expect(result[0].block_id).toBe('b')
    })
  })

  // ── cardCount ──

  it('cardCount 返回卡片数量', () => {
    const store = useBlockCardStore()
    expect(store.cardCount).toBe(0)

    store.cards = [makeCard(), makeCard()]
    expect(store.cardCount).toBe(2)
  })

  // ── 边界条件 ──

  it('多次 invalidate 同一 ID 不重复添加', async () => {
    mockGetBlockCards.mockResolvedValue([])
    const store = useBlockCardStore()
    store.cards = [
      makeCard({ block_id: 'a' }),
      makeCard({ block_id: 'b' }),
    ]

    store.invalidate('a')
    store.invalidate('a')
    store.invalidate('a')

    await store.refreshIfDirty()

    expect(store.cards.length).toBe(1)
    expect(store.cards[0].block_id).toBe('b')
  })

  it('invalidate 混合：先全脏后指定', async () => {
    const newCards = [makeCard({ block_id: 'new' })]
    mockGetBlockCards.mockResolvedValue(newCards)

    const store = useBlockCardStore()
    store.invalidate()
    store.invalidate('some-id')

    await store.refreshIfDirty()

    expect(mockGetBlockCards).toHaveBeenCalled()
    expect(store.cards).toEqual(newCards)
  })
})
