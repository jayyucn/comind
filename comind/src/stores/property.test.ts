import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePropertyStore } from './property'

const mockPropertyService = {
  getByBlockId: vi.fn(),
  getByBlockIds: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  updateSortOrder: vi.fn(),
  toggleHidden: vi.fn()
}

vi.mock('../core', () => ({
  getCore: () => ({
    propertyService: mockPropertyService
  })
}))

vi.mock('../types/property', () => ({
  getAllPropertyDefinitions: vi.fn(() => [
    { key: 'priority', label: '优先级', type: 'select' },
    { key: 'status', label: '状态', type: 'text' }
  ]),
  getPropertyDefinition: vi.fn((key: string) => {
    if (key === 'priority') {
      return { key: 'priority', label: '优先级', type: 'select' }
    }
    return undefined
  })
}))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('usePropertyStore', () => {
  describe('builtInProperties', () => {
    test('返回内置属性定义', () => {
      const store = usePropertyStore()
      expect(store.builtInProperties.length).toBeGreaterThan(0)
    })
  })

  describe('getPropertyDef', () => {
    test('获取属性定义', () => {
      const store = usePropertyStore()
      const def = store.getPropertyDef('priority')
      expect(def).toBeDefined()
      expect(def?.key).toBe('priority')
    })

    test('获取不存在的属性定义返回 undefined', () => {
      const store = usePropertyStore()
      const def = store.getPropertyDef('non-existent')
      expect(def).toBeUndefined()
    })
  })

  describe('getBlockProperties', () => {
    test('初始返回空数组', () => {
      const store = usePropertyStore()
      const props = store.getBlockProperties('block-1')
      expect(props).toEqual([])
    })

    test('获取已加载的属性', async () => {
      vi.mocked(mockPropertyService.getByBlockId).mockResolvedValue([
        { id: 'prop-1', blockId: 'block-1', key: 'priority', value: 'high', type: 'select', sortOrder: 0, isHidden: false, isDeleted: false, schemaVersion: 1, createdAt: Date.now(), updatedAt: Date.now() }
      ])

      const store = usePropertyStore()
      await store.loadBlockProperties('block-1')
      const props = store.getBlockProperties('block-1')
      expect(props.length).toBe(1)
    })
  })

  describe('getBlockProperty', () => {
    test('通过 key 获取属性', async () => {
      vi.mocked(mockPropertyService.getByBlockId).mockResolvedValue([
        { id: 'prop-1', blockId: 'block-1', key: 'priority', value: 'high', type: 'select', sortOrder: 0, isHidden: false, isDeleted: false, schemaVersion: 1, createdAt: Date.now(), updatedAt: Date.now() }
      ])

      const store = usePropertyStore()
      await store.loadBlockProperties('block-1')
      const prop = store.getBlockProperty('block-1', 'priority')
      expect(prop?.key).toBe('priority')
      expect(prop?.value).toBe('high')
    })

    test('获取不存在的属性返回 undefined', async () => {
      vi.mocked(mockPropertyService.getByBlockId).mockResolvedValue([])

      const store = usePropertyStore()
      await store.loadBlockProperties('block-1')
      const prop = store.getBlockProperty('block-1', 'non-existent')
      expect(prop).toBeUndefined()
    })
  })

  describe('loadBlockProperties', () => {
    test('加载属性并缓存', async () => {
      vi.mocked(mockPropertyService.getByBlockId).mockResolvedValue([
        { id: 'prop-1', blockId: 'block-1', key: 'priority', value: 'high', type: 'select', sortOrder: 0, isHidden: false, isDeleted: false, schemaVersion: 1, createdAt: Date.now(), updatedAt: Date.now() }
      ])

      const store = usePropertyStore()
      expect(store.loading).toBe(false)
      const props = await store.loadBlockProperties('block-1')
      expect(store.loading).toBe(false)
      expect(props.length).toBe(1)
      expect(mockPropertyService.getByBlockId).toHaveBeenCalledWith('block-1')
    })
  })

  describe('loadMultiBlockProperties', () => {
    test('批量加载多个 block 的属性', async () => {
      vi.mocked(mockPropertyService.getByBlockId).mockResolvedValueOnce([
        { id: 'prop-1', blockId: 'block-1', key: 'priority', value: 'high', type: 'select', sortOrder: 0, isHidden: false, isDeleted: false, schemaVersion: 1, createdAt: Date.now(), updatedAt: Date.now() }
      ])
      vi.mocked(mockPropertyService.getByBlockId).mockResolvedValueOnce([
        { id: 'prop-2', blockId: 'block-2', key: 'status', value: 'active', type: 'text', sortOrder: 0, isHidden: false, isDeleted: false, schemaVersion: 1, createdAt: Date.now(), updatedAt: Date.now() }
      ])

      const store = usePropertyStore()
      await store.loadMultiBlockProperties(['block-1', 'block-2'])
      expect(mockPropertyService.getByBlockId).toHaveBeenCalledWith('block-1')
      expect(mockPropertyService.getByBlockId).toHaveBeenCalledWith('block-2')
      expect(store.getBlockProperties('block-1').length).toBe(1)
      expect(store.getBlockProperties('block-2').length).toBe(1)
    })
  })

  describe('setProperty', () => {
    test('设置属性并重新加载', async () => {
      const newProp = { id: 'prop-1', blockId: 'block-1', key: 'priority', value: 'medium', type: 'select', sortOrder: 0, isHidden: false, isDeleted: false, schemaVersion: 1, createdAt: Date.now(), updatedAt: Date.now() }
      vi.mocked(mockPropertyService.create).mockResolvedValue(newProp)
      vi.mocked(mockPropertyService.getByBlockId).mockResolvedValue([newProp])

      const store = usePropertyStore()
      const result = await store.setProperty('block-1', 'priority', 'medium', 'select')
      expect(result).toEqual(newProp)
      expect(mockPropertyService.create).toHaveBeenCalledWith('block-1', 'priority', 'medium', 'select')
    })
  })

  describe('deleteProperty', () => {
    test('删除属性并重新加载', async () => {
      vi.mocked(mockPropertyService.delete).mockResolvedValue(undefined)
      vi.mocked(mockPropertyService.getByBlockId).mockResolvedValue([])

      const store = usePropertyStore()
      await store.deleteProperty('prop-1', 'block-1')
      expect(mockPropertyService.delete).toHaveBeenCalledWith('prop-1')
    })
  })

  describe('updateSortOrder', () => {
    test('更新排序并重新加载', async () => {
      vi.mocked(mockPropertyService.updateSortOrder).mockResolvedValue(undefined)
      vi.mocked(mockPropertyService.getByBlockId).mockResolvedValue([])

      const store = usePropertyStore()
      await store.updateSortOrder('block-1', ['prop-1', 'prop-2'])
      expect(mockPropertyService.updateSortOrder).toHaveBeenCalledWith('block-1', ['prop-1', 'prop-2'])
    })
  })

  describe('toggleHidden', () => {
    test('切换隐藏状态并重新加载', async () => {
      const updatedProp = { id: 'prop-1', blockId: 'block-1', key: 'priority', value: 'high', type: 'select', sortOrder: 0, isHidden: true, isDeleted: false, schemaVersion: 1, createdAt: Date.now(), updatedAt: Date.now() }
      vi.mocked(mockPropertyService.toggleHidden).mockResolvedValue(updatedProp)
      vi.mocked(mockPropertyService.getByBlockId).mockResolvedValue([updatedProp])

      const store = usePropertyStore()
      const result = await store.toggleHidden('prop-1', 'block-1')
      expect(result.isHidden).toBe(true)
      expect(mockPropertyService.toggleHidden).toHaveBeenCalledWith('prop-1')
    })
  })

  describe('clearBlockCache', () => {
    test('清除 block 缓存', async () => {
      vi.mocked(mockPropertyService.getByBlockId).mockResolvedValue([
        { id: 'prop-1', blockId: 'block-1', key: 'priority', value: 'high', type: 'select', sortOrder: 0, isHidden: false, isDeleted: false, schemaVersion: 1, createdAt: Date.now(), updatedAt: Date.now() }
      ])

      const store = usePropertyStore()
      await store.loadBlockProperties('block-1')
      expect(store.getBlockProperties('block-1').length).toBe(1)

      store.clearBlockCache('block-1')
      expect(store.getBlockProperties('block-1')).toEqual([])
    })
  })
})
