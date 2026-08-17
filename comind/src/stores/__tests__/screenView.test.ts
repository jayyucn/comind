import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const {
  mockGetScreenViews,
  mockSaveScreenView,
  mockUpdateScreenView,
  mockDeleteScreenView,
  mockSetDefaultScreenView,
  mockInitCoreClient,
} = vi.hoisted(() => {
  return {
    mockGetScreenViews: vi.fn(),
    mockSaveScreenView: vi.fn(),
    mockUpdateScreenView: vi.fn(),
    mockDeleteScreenView: vi.fn(),
    mockSetDefaultScreenView: vi.fn(),
    mockInitCoreClient: vi.fn(),
  }
})

vi.mock('../../wasm/client', () => {
  return {
    initCoreClient: mockInitCoreClient,
    getCoreClient: vi.fn(),
  }
})

function makeView(overrides: Partial<import('../../wasm/types').ScreenViewRust> = {}) {
  return {
    id: 'view-1',
    user_id: 'user-1',
    name: '测试视图',
    status: 1,
    sort_order: 0,
    filters: '',
    group_by: '',
    sorting: '',
    layout: 0,
    is_default: 0,
    updated_at: 1000,
    created_at: 1000,
    ...overrides,
  }
}

function createMockClient(overrides: Record<string, any> = {}) {
  return {
    getScreenViews: mockGetScreenViews,
    saveScreenView: mockSaveScreenView,
    updateScreenView: mockUpdateScreenView,
    deleteScreenView: mockDeleteScreenView,
    setDefaultScreenView: mockSetDefaultScreenView,
    ...overrides,
  }
}

describe('screenView store', () => {
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
    mockSaveScreenView.mockImplementation(async (name: string) => makeView({
      id: 'saved-' + Date.now(),
      name,
      is_default: 1,
    }))
    mockUpdateScreenView.mockImplementation(async (id: string, name: string) => makeView({
      id,
      name,
    }))
    mockDeleteScreenView.mockResolvedValue()
    mockSetDefaultScreenView.mockImplementation(async (id: string) => makeView({
      id,
      is_default: 1,
    }))
    mockInitCoreClient.mockResolvedValue(createMockClient())
  })

  // ── load ──

  describe('load', () => {
    it('无视图时自动创建默认"全部任务"视图', async () => {
      const store = useScreenViewStore()
      await store.load()

      expect(mockSaveScreenView).toHaveBeenCalledTimes(1)
      expect(store.views.length).toBeGreaterThanOrEqual(1)
      expect(store.views[0].is_default).toBe(1)
    })

    it('已有视图时不创建默认视图', async () => {
      const existing = makeView({ id: 'existing', is_default: 0 })
      mockGetScreenViews.mockResolvedValue([existing])

      const store = useScreenViewStore()
      await store.load()

      expect(mockSaveScreenView).not.toHaveBeenCalled()
      expect(store.views.length).toBe(1)
      expect(store.views[0].id).toBe('existing')
    })

    it('加载后自动设置 currentViewId 为默认视图', async () => {
      const existing = makeView({ id: 'default-1', is_default: 1 })
      mockGetScreenViews.mockResolvedValue([existing])

      const store = useScreenViewStore()
      await store.load()

      expect(store.currentViewId).toBe('default-1')
    })

    it('无默认视图时使用第一个视图作为 currentViewId', async () => {
      const v1 = makeView({ id: 'v1', is_default: 0 })
      const v2 = makeView({ id: 'v2', is_default: 0 })
      mockGetScreenViews.mockResolvedValue([v1, v2])

      const store = useScreenViewStore()
      await store.load()

      expect(store.currentViewId).toBe('v1')
    })

    it('setDefault 失败不影响加载流程', async () => {
      mockSetDefaultScreenView.mockRejectedValue(new Error('setDefault failed'))

      const store = useScreenViewStore()
      await store.load()

      expect(mockSetDefaultScreenView).toHaveBeenCalled()
      expect(store.views.length).toBeGreaterThanOrEqual(0)
    })

    it('loading 状态正确管理', async () => {
      let resolveClient: ((value: any) => void) | null = null
      mockInitCoreClient.mockImplementation(
        () => new Promise(resolve => { resolveClient = resolve })
      )

      const store = useScreenViewStore()
      const loadPromise = store.load()

      expect(store.loading).toBe(true)

      resolveClient!(createMockClient())
      await loadPromise

      expect(store.loading).toBe(false)
    })
  })

  // ── save ──

  describe('save', () => {
    it('保存新视图并追加到列表', async () => {
      mockSaveScreenView.mockResolvedValue(makeView({ id: 'new', name: '新视图' }))

      const store = useScreenViewStore()
      const result = await store.save('新视图', '{}', 'table', '', '')

      expect(mockSaveScreenView).toHaveBeenCalledWith('新视图', '{}', 'table', '', '')
      expect(result.id).toBe('new')
      expect(store.views.length).toBe(1)
      expect(store.views[0].id).toBe('new')
    })
  })

  // ── update ──

  describe('update', () => {
    it('更新已有视图并替换内存中的数据', async () => {
      const v1 = makeView({ id: 'v1', name: 'old' })
      const v2 = makeView({ id: 'v2' })
      mockUpdateScreenView.mockResolvedValue(makeView({ id: 'v1', name: 'new' }))

      const store = useScreenViewStore()
      store.views = [v1, v2]

      await store.update('v1', 'new', '{}', 'table', '', false, 0, '')

      expect(mockUpdateScreenView).toHaveBeenCalledWith('v1', 'new', '{}', 'table', '', false, 0, '')
      const updated = store.views.find(v => v.id === 'v1')
      expect(updated?.name).toBe('new')
    })

    it('更新不存在的 ID 时仍然调用后端', async () => {
      mockUpdateScreenView.mockResolvedValue(makeView({ id: 'ghost' }))

      const store = useScreenViewStore()
      store.views = [makeView({ id: 'existing' })]

      await store.update('ghost', 'name', '{}', 'table', '', false, 0, '')

      expect(mockUpdateScreenView).toHaveBeenCalled()
    })
  })

  // ── remove ──

  describe('remove', () => {
    it('删除视图并从列表移除', async () => {
      const v1 = makeView({ id: 'v1' })
      const v2 = makeView({ id: 'v2' })

      const store = useScreenViewStore()
      store.views = [v1, v2]
      store.currentViewId = 'v1'

      await store.remove('v2')

      expect(mockDeleteScreenView).toHaveBeenCalledWith('v2')
      expect(store.views.length).toBe(1)
      expect(store.views[0].id).toBe('v1')
    })

    it('删除当前视图时回退到第一个视图', async () => {
      const v1 = makeView({ id: 'v1' })
      const v2 = makeView({ id: 'v2' })

      const store = useScreenViewStore()
      store.views = [v1, v2]
      store.currentViewId = 'v1'

      await store.remove('v1')

      expect(store.currentViewId).toBe('v2')
    })

    it('删除最后一个视图时 currentViewId 为 null', async () => {
      const v1 = makeView({ id: 'v1' })

      const store = useScreenViewStore()
      store.views = [v1]
      store.currentViewId = 'v1'

      await store.remove('v1')

      expect(store.currentViewId).toBeNull()
    })
  })

  // ── setDefault ──

  describe('setDefault', () => {
    it('设置默认视图后，其他视图的 is_default 变为 0', async () => {
      const v1 = makeView({ id: 'v1', is_default: 1 })
      const v2 = makeView({ id: 'v2', is_default: 0 })
      mockSetDefaultScreenView.mockResolvedValue(makeView({ id: 'v2', is_default: 1 }))

      const store = useScreenViewStore()
      store.views = [v1, v2]

      await store.setDefault('v2')

      expect(mockSetDefaultScreenView).toHaveBeenCalledWith('v2')
      const v2After = store.views.find(v => v.id === 'v2')
      expect(v2After?.is_default).toBe(1)
      const v1After = store.views.find(v => v.id === 'v1')
      expect(v1After?.is_default).toBe(0)
    })

    it('设置默认视图时只有一个视图的 is_default 为 1', async () => {
      const v1 = makeView({ id: 'v1' })
      const v2 = makeView({ id: 'v2' })
      const v3 = makeView({ id: 'v3' })
      mockSetDefaultScreenView.mockResolvedValue(makeView({ id: 'v2', is_default: 1 }))

      const store = useScreenViewStore()
      store.views = [v1, v2, v3]

      await store.setDefault('v2')

      const defaults = store.views.filter(v => v.is_default === 1)
      expect(defaults.length).toBe(1)
      expect(defaults[0].id).toBe('v2')
    })
  })
})
