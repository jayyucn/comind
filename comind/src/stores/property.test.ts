import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePropertyStore } from './property'

vi.mock('../services/property', () => ({
  propertyService: {
    getProperties: vi.fn(),
    getPropertiesByBlockIds: vi.fn(),
    setProperty: vi.fn(),
    deleteProperty: vi.fn(),
    updateSortOrder: vi.fn(),
    toggleHidden: vi.fn()
  }
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
      const { propertyService } = await import('../services/property')
      vi.mocked(propertyService.getProperties).mockResolvedValue([
        { id: 'prop-1', blockId: 'block-1', key: 'priority', value: 'high', type: 'select' }
      ])

      const store = usePropertyStore()
      await store.loadBlockProperties('block-1')
      const props = store.getBlockProperties('block-1')
      expect(props.length).toBe(1)
    })
  })

  describe('getBlockProperty', () => {
    test('通过 key 获取属性', async () => {
      const { propertyService } = await import('../services/property')
      vi.mocked(propertyService.getProperties).mockResolvedValue([
        { id: 'prop-1', blockId: 'block-1', key: 'priority', value: 'high', type: 'select' }
      ])

      const store = usePropertyStore()
      await store.loadBlockProperties('block-1')
      const prop = store.getBlockProperty('block-1', 'priority')
      expect(prop?.key).toBe('priority')
      expect(prop?.value).toBe('high')
    })

    test('获取不存在的属性返回 undefined', async () => {
      const { propertyService } = await import('../services/property')
      vi.mocked(propertyService.getProperties).mockResolvedValue([])

      const store = usePropertyStore()
      await store.loadBlockProperties('block-1')
      const prop = store.getBlockProperty('block-1', 'non-existent')
      expect(prop).toBeUndefined()
    })
  })

  describe('loadBlockProperties', () => {
    test('加载属性并缓存', async () => {
      const { propertyService } = await import('../services/property')
      vi.mocked(propertyService.getProperties).mockResolvedValue([
        { id: 'prop-1', blockId: 'block-1', key: 'priority', value: 'high', type: 'select' }
      ])

      const store = usePropertyStore()
      expect(store.loading).toBe(false)
      const props = await store.loadBlockProperties('block-1')
      expect(store.loading).toBe(false)
      expect(props.length).toBe(1)
      expect(propertyService.getProperties).toHaveBeenCalledWith('block-1')
    })
  })

  describe('loadMultiBlockProperties', () => {
    test('批量加载多个 block 的属性', async () => {
      const { propertyService } = await import('../services/property')
      const mockMap = new Map()
      mockMap.set('block-1', [{ id: 'prop-1', blockId: 'block-1', key: 'priority', value: 'high' }])
      mockMap.set('block-2', [{ id: 'prop-2', blockId: 'block-2', key: 'status', value: 'active' }])
      vi.mocked(propertyService.getPropertiesByBlockIds).mockResolvedValue(mockMap)

      const store = usePropertyStore()
      await store.loadMultiBlockProperties(['block-1', 'block-2'])
      expect(propertyService.getPropertiesByBlockIds).toHaveBeenCalledWith(['block-1', 'block-2'])
      expect(store.getBlockProperties('block-1').length).toBe(1)
      expect(store.getBlockProperties('block-2').length).toBe(1)
    })
  })

  describe('setProperty', () => {
    test('设置属性并重新加载', async () => {
      const { propertyService } = await import('../services/property')
      const newProp = { id: 'prop-1', blockId: 'block-1', key: 'priority', value: 'medium', type: 'select' }
      vi.mocked(propertyService.setProperty).mockResolvedValue(newProp)
      vi.mocked(propertyService.getProperties).mockResolvedValue([newProp])

      const store = usePropertyStore()
      const result = await store.setProperty('block-1', 'priority', 'medium', 'select')
      expect(result).toEqual(newProp)
      expect(propertyService.setProperty).toHaveBeenCalledWith('block-1', 'priority', 'medium', 'select')
    })
  })

  describe('deleteProperty', () => {
    test('删除属性并重新加载', async () => {
      const { propertyService } = await import('../services/property')
      vi.mocked(propertyService.deleteProperty).mockResolvedValue(undefined)
      vi.mocked(propertyService.getProperties).mockResolvedValue([])

      const store = usePropertyStore()
      await store.deleteProperty('prop-1', 'block-1')
      expect(propertyService.deleteProperty).toHaveBeenCalledWith('prop-1')
    })
  })

  describe('updateSortOrder', () => {
    test('更新排序并重新加载', async () => {
      const { propertyService } = await import('../services/property')
      vi.mocked(propertyService.updateSortOrder).mockResolvedValue(undefined)
      vi.mocked(propertyService.getProperties).mockResolvedValue([])

      const store = usePropertyStore()
      await store.updateSortOrder('block-1', ['prop-1', 'prop-2'])
      expect(propertyService.updateSortOrder).toHaveBeenCalledWith('block-1', ['prop-1', 'prop-2'])
    })
  })

  describe('toggleHidden', () => {
    test('切换隐藏状态并重新加载', async () => {
      const { propertyService } = await import('../services/property')
      const updatedProp = { id: 'prop-1', blockId: 'block-1', key: 'priority', value: 'high', hidden: true }
      vi.mocked(propertyService.toggleHidden).mockResolvedValue(updatedProp)
      vi.mocked(propertyService.getProperties).mockResolvedValue([updatedProp])

      const store = usePropertyStore()
      const result = await store.toggleHidden('prop-1', 'block-1')
      expect(result.hidden).toBe(true)
      expect(propertyService.toggleHidden).toHaveBeenCalledWith('prop-1')
    })
  })

  describe('clearBlockCache', () => {
    test('清除 block 缓存', async () => {
      const { propertyService } = await import('../services/property')
      vi.mocked(propertyService.getProperties).mockResolvedValue([
        { id: 'prop-1', blockId: 'block-1', key: 'priority', value: 'high', type: 'select' }
      ])

      const store = usePropertyStore()
      await store.loadBlockProperties('block-1')
      expect(store.getBlockProperties('block-1').length).toBe(1)
      
      store.clearBlockCache('block-1')
      expect(store.getBlockProperties('block-1')).toEqual([])
    })
  })
})
