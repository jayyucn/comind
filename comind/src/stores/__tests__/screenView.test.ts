import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { LayoutConfig } from '../../core/view'
import type { ScreenViewRust } from '../../wasm/types'

const {
  mockGetScreenViews,
  mockCreateScreen,
  mockCreateTab,
  mockUpdateScreen,
  mockUpdateTab,
  mockDeleteScreen,
  mockDeleteScreenView,
  mockSetDefaultScreen,
  mockInitCoreClient,
} = vi.hoisted(() => {
  return {
    mockGetScreenViews: vi.fn(),
    mockCreateScreen: vi.fn(),
    mockCreateTab: vi.fn(),
    mockUpdateScreen: vi.fn(),
    mockUpdateTab: vi.fn(),
    mockDeleteScreen: vi.fn(),
    mockDeleteScreenView: vi.fn(),
    mockSetDefaultScreen: vi.fn(),
    mockInitCoreClient: vi.fn(),
  }
})

vi.mock('../../wasm/client', () => {
  return {
    initCoreClient: mockInitCoreClient,
    getCoreClient: vi.fn(),
  }
})

const EMPTY_QUERY = { version: 1, filter: { combinator: 'and', children: [] }, sort: [], groupBy: null }
const DIRTY_QUERY = { version: 1, filter: { combinator: 'and', children: [{ field: 'status', op: 'eq', value: 'Done' }] }, sort: [], groupBy: null }

function makeScreen(overrides: Partial<ScreenViewRust> = {}): ScreenViewRust {
  return {
    id: 'screen-1',
    entity: 'block',
    parent_id: '',
    name: 'Screen',
    query_json: '{}',
    view_type: 'table',
    group_by: '',
    is_default: 0,
    sort_order: 0,
    config: '{}',
    created_at: 1000,
    updated_at: 1000,
    ...overrides,
  }
}

function makeTab(overrides: Partial<ScreenViewRust> = {}): ScreenViewRust {
  return {
    id: 'tab-1',
    entity: 'block',
    parent_id: 'screen-1',
    name: '',
    query_json: JSON.stringify(EMPTY_QUERY),
    view_type: 'table',
    group_by: '',
    is_default: 0,
    sort_order: 1,
    config: '{}',
    created_at: 1000,
    updated_at: 1000,
    ...overrides,
  }
}

function createMockClient(overrides: Record<string, unknown> = {}) {
  return {
    getScreenViews: mockGetScreenViews,
    createScreen: mockCreateScreen,
    createTab: mockCreateTab,
    updateScreen: mockUpdateScreen,
    updateTab: mockUpdateTab,
    deleteScreen: mockDeleteScreen,
    deleteScreenView: mockDeleteScreenView,
    setDefaultScreen: mockSetDefaultScreen,
    ...overrides,
  }
}

describe('screenView store (two-level Screen→Tab)', () => {
  let useScreenViewStore: typeof import('../screenView').useScreenViewStore

  beforeEach(async () => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()

    vi.doMock('../../wasm/client', () => ({
      initCoreClient: mockInitCoreClient,
      getCoreClient: vi.fn(),
    }))

    useScreenViewStore = (await import('../screenView')).useScreenViewStore

    mockGetScreenViews.mockResolvedValue([])
    mockCreateScreen.mockImplementation(async (_entity: string, name: string, viewType: string, _sort: number, config: string) =>
      makeScreen({ id: 'seed-screen', name, view_type: viewType, is_default: 1, config }),
    )
    mockCreateTab.mockImplementation(async (_entity: string, parentId: string, name: string, viewType: string, queryJson: string, _sort: number, config: string) =>
      makeTab({ id: 'seed-tab', parent_id: parentId, name, view_type: viewType, query_json: queryJson, config }),
    )
    mockUpdateScreen.mockImplementation(async (id: string, name: string, viewType: string, config: string) =>
      makeScreen({ id, name, view_type: viewType, config }),
    )
    mockUpdateTab.mockImplementation(async (id: string, name: string, viewType: string, queryJson: string, config: string) =>
      makeTab({ id, name, view_type: viewType, query_json: queryJson, config, parent_id: 's1' }),
    )
    mockDeleteScreen.mockResolvedValue()
    mockDeleteScreenView.mockResolvedValue()
    mockSetDefaultScreen.mockImplementation(async (id: string) => makeScreen({ id, is_default: 1 }))
    mockInitCoreClient.mockResolvedValue(createMockClient())
  })

  // ── load ──

  describe('load', () => {
    it('无视图时自动 seed 默认 Screen + 一个 Tab', async () => {
      const store = useScreenViewStore()
      await store.load()

      expect(mockCreateScreen).toHaveBeenCalledTimes(1)
      expect(mockCreateTab).toHaveBeenCalledTimes(1)
      expect(store.screens.length).toBe(1)
      expect(store.screens[0].is_default).toBe(1)
      expect(store.currentTabs.length).toBe(1)
      expect(store.currentScreenId).toBe('seed-screen')
      expect(store.currentTabId).toBe('seed-tab')
    })

    it('注入 defaultConfig 时 seed 写入实体默认布局；未注入时写空串（ADR-0023 上游修复）', async () => {
      // 注入：seed 的 Screen/Tab config = 实体默认布局 JSON
      const injected = useScreenViewStore('block', {
        defaultConfig: (kind) => ({ viewKind: kind, version: 1, columns: [{ key: 'content', role: 'primary' }] }) as LayoutConfig,
      })
      await injected.load()
      expect(mockCreateScreen).toHaveBeenLastCalledWith('block', expect.any(String), 'table', 0, JSON.stringify({ viewKind: 'table', version: 1, columns: [{ key: 'content', role: 'primary' }] }))
      expect(mockCreateTab).toHaveBeenLastCalledWith('block', 'seed-screen', '', 'table', expect.any(String), 1, JSON.stringify({ viewKind: 'table', version: 1, columns: [{ key: 'content', role: 'primary' }] }))

      // 未注入：config 写空串，渲染层回退消费方默认
      vi.resetModules()
      setActivePinia(createPinia())
      useScreenViewStore = (await import('../screenView')).useScreenViewStore
      const plain = useScreenViewStore('page')
      await plain.load()
      expect(mockCreateScreen).toHaveBeenLastCalledWith('page', expect.any(String), 'table', 0, '')
      expect(mockCreateTab).toHaveBeenLastCalledWith('page', 'seed-screen', '', 'table', expect.any(String), 1, '')
    })

    it('已有视图时不 seed，并选中默认 Screen 的首个 Tab', async () => {
      const screen = makeScreen({ id: 's1', is_default: 1, name: '全部任务' })
      const tab = makeTab({ id: 't1', parent_id: 's1' })
      mockGetScreenViews.mockResolvedValue([screen, tab])

      const store = useScreenViewStore()
      await store.load()

      expect(mockCreateScreen).not.toHaveBeenCalled()
      expect(store.screens.length).toBe(1)
      expect(store.currentScreenId).toBe('s1')
      expect(store.currentTabId).toBe('t1')
    })

    it('无默认视图时使用第一个 Screen', async () => {
      const s1 = makeScreen({ id: 's1', is_default: 0 })
      const s2 = makeScreen({ id: 's2', is_default: 0 })
      mockGetScreenViews.mockResolvedValue([s1, s2, makeTab({ id: 't1', parent_id: 's1' })])

      const store = useScreenViewStore()
      await store.load()

      expect(store.currentScreenId).toBe('s1')
    })

    it('loading 状态正确管理', async () => {
      let resolveClient: ((value: unknown) => void) | null = null
      mockInitCoreClient.mockImplementation(() => new Promise(resolve => { resolveClient = resolve }))

      const store = useScreenViewStore()
      const loadPromise = store.load()

      expect(store.loading).toBe(true)

      resolveClient!(createMockClient())
      await loadPromise

      expect(store.loading).toBe(false)
    })
  })

  // ── 选择 / 脏点 ──

  describe('selection & dirty', () => {
    it('selectTab 载入已提交查询并清脏点', async () => {
      const store = useScreenViewStore()
      store.views = [makeScreen({ id: 's1' }), makeTab({ id: 't1', parent_id: 's1' })]
      store.currentScreenId = 's1'

      await store.selectTab('t1')

      expect(store.currentTabId).toBe('t1')
      expect(store.dirty).toBe(false)
      expect(JSON.stringify(store.workingQuery)).toBe(JSON.stringify(EMPTY_QUERY))
    })

    it('setWorkingQuery 与已提交不一致时标记脏点', async () => {
      const store = useScreenViewStore()
      store.views = [makeScreen({ id: 's1' }), makeTab({ id: 't1', parent_id: 's1' })]
      store.currentScreenId = 's1'
      await store.selectTab('t1')

      store.setWorkingQuery(DIRTY_QUERY as never)

      expect(store.dirty).toBe(true)
      expect(store.dirtyByTab.has('t1')).toBe(true)
    })

    it('saveActiveTab 持久化并清脏点', async () => {
      const store = useScreenViewStore()
      store.views = [makeScreen({ id: 's1' }), makeTab({ id: 't1', parent_id: 's1' })]
      store.currentScreenId = 's1'
      await store.selectTab('t1')
      store.setWorkingQuery(DIRTY_QUERY as never)

      await store.saveActiveTab()

      expect(mockUpdateTab).toHaveBeenCalledWith('t1', '', 'table', JSON.stringify(DIRTY_QUERY), '{}')
      expect(store.dirty).toBe(false)
    })

    it('discardActiveTab 回退到已提交查询并清脏点', async () => {
      const store = useScreenViewStore()
      store.views = [makeScreen({ id: 's1' }), makeTab({ id: 't1', parent_id: 's1' })]
      store.currentScreenId = 's1'
      await store.selectTab('t1')
      store.setWorkingQuery(DIRTY_QUERY as never)

      await store.discardActiveTab()

      expect(store.dirty).toBe(false)
      expect(JSON.stringify(store.workingQuery)).toBe(JSON.stringify(EMPTY_QUERY))
    })

    it('切换 tab 暂存草稿，切回恢复', async () => {
      const store = useScreenViewStore()
      const t1 = makeTab({ id: 't1', parent_id: 's1' })
      const t2 = makeTab({ id: 't2', parent_id: 's1' })
      store.views = [makeScreen({ id: 's1' }), t1, t2]
      store.currentScreenId = 's1'
      await store.selectTab('t1')
      store.setWorkingQuery(DIRTY_QUERY as never)

      await store.selectTab('t2')
      expect(store.dirty).toBe(false)

      await store.selectTab('t1')
      expect(store.dirty).toBe(true)
      expect(JSON.stringify(store.workingQuery)).toBe(JSON.stringify(DIRTY_QUERY))
    })

    it('切换 Screen 同样暂存/恢复当前 tab 草稿', async () => {
      const store = useScreenViewStore()
      const tabA = makeTab({ id: 'ta', parent_id: 'sa' })
      const tabB = makeTab({ id: 'tb', parent_id: 'sb' })
      store.views = [makeScreen({ id: 'sa', name: 'A' }), makeScreen({ id: 'sb', name: 'B' }), tabA, tabB]
      store.currentScreenId = 'sa'
      await store.selectTab('ta')
      store.setWorkingQuery(DIRTY_QUERY as never)

      await store.selectScreen('sb')
      expect(store.currentScreenId).toBe('sb')
      expect(store.dirty).toBe(false)

      await store.selectScreen('sa')
      expect(store.dirty).toBe(true)
      expect(JSON.stringify(store.workingQuery)).toBe(JSON.stringify(DIRTY_QUERY))
    })
  })

  // ── 创建 ──

  describe('create', () => {
    it('createScreen 创建 Screen + 默认 Tab 并选中', async () => {
      const store = useScreenViewStore()
      store.views = [makeScreen({ id: 's1' })]

      await store.createScreen('我的 Screen')

      expect(mockCreateScreen).toHaveBeenCalledWith('block', '我的 Screen', 'table', expect.any(Number), expect.any(String))
      expect(mockCreateTab).toHaveBeenCalled()
      expect(store.screens.length).toBe(2)
      expect(store.currentScreenId).toBe('seed-screen')
    })

    it('createTab 在当前 Screen 下创建 Tab 并选中', async () => {
      const store = useScreenViewStore()
      store.views = [makeScreen({ id: 's1' }), makeTab({ id: 't1', parent_id: 's1' })]
      store.currentScreenId = 's1'
      await store.selectTab('t1')

      await store.createTab('新看板', 'board')

      expect(mockCreateTab).toHaveBeenCalledWith('block', 's1', '新看板', 'board', expect.any(String), expect.any(Number), expect.any(String))
      const created = store.views.find(v => v.id === 'seed-tab')
      expect(created?.view_type).toBe('board')
      expect(store.currentTabId).toBe('seed-tab')
    })

    it('createTab 不传名时默认用类型名', async () => {
      const store = useScreenViewStore()
      store.views = [makeScreen({ id: 's1' }), makeTab({ id: 't1', parent_id: 's1' })]
      store.currentScreenId = 's1'
      await store.selectTab('t1')

      await store.createTab(undefined, 'calendar')

      expect(mockCreateTab).toHaveBeenCalledWith('block', 's1', '', 'calendar', expect.any(String), expect.any(Number), expect.any(String))
    })
  })

  // ── 重命名 ──

  describe('rename', () => {
    it('renameScreen 更新 Screen 名', async () => {
      const store = useScreenViewStore()
      store.views = [makeScreen({ id: 's1', name: '旧' }), makeTab({ id: 't1', parent_id: 's1' })]

      await store.renameScreen('s1', '新名')

      expect(mockUpdateScreen).toHaveBeenCalledWith('s1', '新名', 'table', '{}')
      expect(store.screens.find(v => v.id === 's1')?.name).toBe('新名')
    })

    it('renameTab 更新 Tab 名', async () => {
      const store = useScreenViewStore()
      store.views = [makeScreen({ id: 's1' }), makeTab({ id: 't1', parent_id: 's1', name: '' })]
      store.currentScreenId = 's1'
      store.currentTabId = 't1'

      await store.renameTab('t1', '重命名 Tab')

      expect(mockUpdateTab).toHaveBeenCalledWith('t1', '重命名 Tab', 'table', JSON.stringify(EMPTY_QUERY), '{}')
      expect(store.currentTab?.name).toBe('重命名 Tab')
    })
  })

  // ── 默认 ──

  describe('setDefaultScreen', () => {
    it('设默认后该 Screen is_default=1，其余为 0', async () => {
      const store = useScreenViewStore()
      store.views = [
        makeScreen({ id: 's1', is_default: 1 }),
        makeScreen({ id: 's2', is_default: 0 }),
        makeTab({ id: 't1', parent_id: 's1' }),
      ]

      await store.setDefaultScreen('s2')

      expect(mockSetDefaultScreen).toHaveBeenCalledWith('s2')
      expect(store.screens.find(v => v.id === 's2')?.is_default).toBe(1)
      expect(store.screens.find(v => v.id === 's1')?.is_default).toBe(0)
    })
  })

  // ── 删除 ──

  describe('delete', () => {
    it('deleteScreen 级联移除其下所有 Tab', async () => {
      const store = useScreenViewStore()
      store.views = [
        makeScreen({ id: 's1' }),
        makeScreen({ id: 's2' }),
        makeTab({ id: 't1', parent_id: 's1' }),
        makeTab({ id: 't2', parent_id: 's1' }),
      ]
      store.currentScreenId = 's1'

      await store.deleteScreen('s1')

      expect(mockDeleteScreen).toHaveBeenCalledWith('s1')
      expect(store.views.find(v => v.id === 's1')).toBeUndefined()
      expect(store.views.find(v => v.id === 't1')).toBeUndefined()
      expect(store.views.find(v => v.id === 't2')).toBeUndefined()
      expect(store.screens.length).toBe(1)
    })

    it('仅剩一个 Screen 时禁止删除', async () => {
      const store = useScreenViewStore()
      store.views = [makeScreen({ id: 's1' }), makeTab({ id: 't1', parent_id: 's1' })]
      store.currentScreenId = 's1'

      await store.deleteScreen('s1')

      expect(mockDeleteScreen).not.toHaveBeenCalled()
      expect(store.screens.length).toBe(1)
    })

    it('deleteTab 移除 Tab 并回退到同 Screen 首个 Tab', async () => {
      const store = useScreenViewStore()
      store.views = [
        makeScreen({ id: 's1' }),
        makeTab({ id: 't1', parent_id: 's1' }),
        makeTab({ id: 't2', parent_id: 's1' }),
      ]
      store.currentScreenId = 's1'
      store.currentTabId = 't1'

      await store.deleteTab('t1')

      expect(mockDeleteScreenView).toHaveBeenCalledWith('t1')
      expect(store.views.find(v => v.id === 't1')).toBeUndefined()
      expect(store.currentTabId).toBe('t2')
    })

    it('仅剩一个 Tab 时禁止删除', async () => {
      const store = useScreenViewStore()
      store.views = [makeScreen({ id: 's1' }), makeTab({ id: 't1', parent_id: 's1' })]
      store.currentScreenId = 's1'
      store.currentTabId = 't1'

      await store.deleteTab('t1')

      expect(mockDeleteScreenView).not.toHaveBeenCalled()
      expect(store.views.length).toBe(2)
    })
  })

  // ── 复制 ──

  describe('duplicateTab', () => {
    it('复制 Tab 继承类型/查询/配置并以副本命名', async () => {
      const store = useScreenViewStore()
      const src = makeTab({ id: 't1', parent_id: 's1', view_type: 'board', query_json: JSON.stringify(DIRTY_QUERY), config: 'cfg' })
      store.views = [makeScreen({ id: 's1' }), src]
      store.currentScreenId = 's1'
      store.currentTabId = 't1'

      await store.duplicateTab('t1', 't1 副本')

      expect(mockCreateTab).toHaveBeenCalledWith('block', 's1', 't1 副本', 'board', JSON.stringify(DIRTY_QUERY), expect.any(Number), 'cfg')
      expect(store.currentTabId).toBe('seed-tab')
    })
  })
})
