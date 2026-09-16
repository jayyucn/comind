import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePropertyStore } from './property'
import type { CoreClient } from '../wasm/client'

// Store 已全面委托 Rust CoreClient（4.2/S6 迁移）；此处 mock client 验证
// store 的缓存/映射/编解码编排。Rust 形状（snake_case、is_hidden 为 0|1）。
const { mockClient } = vi.hoisted(() => {
  const mockClient = {
    getProperties: vi.fn(async () => [] as unknown[]),
    setProperty: vi.fn(async () => ({})),
    deleteProperty: vi.fn(async () => {}),
    getDateRefsByBlock: vi.fn(async () => []),
    calculateNextRecurrence: vi.fn(async (iso: string) => iso),
  }
  return { mockClient }
})

vi.mock('../wasm/client', () => ({
  initCoreClient: vi.fn(() => Promise.resolve(mockClient)),
  getCoreClient: vi.fn(() => mockClient),
}))

function makeRustProp(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prop-1',
    block_id: 'block-1',
    key: 'priority',
    value: '"high"',
    type: 'select',
    sort_order: 0,
    is_hidden: 0,
    is_deleted: 0,
    schema_version: 1,
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  }
}

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
      vi.mocked(mockClient.getProperties).mockResolvedValue([makeRustProp()] as never)

      const store = usePropertyStore()
      await store.loadBlockProperties('block-1')
      const props = store.getBlockProperties('block-1')
      expect(props.length).toBe(1)
    })
  })

  describe('getBlockProperty', () => {
    test('通过 key 获取属性', async () => {
      vi.mocked(mockClient.getProperties).mockResolvedValue([makeRustProp()] as never)

      const store = usePropertyStore()
      await store.loadBlockProperties('block-1')
      const prop = store.getBlockProperty('block-1', 'priority')
      expect(prop?.key).toBe('priority')
      expect(prop?.value).toBe('high')
    })

    test('获取不存在的属性返回 undefined', async () => {
      vi.mocked(mockClient.getProperties).mockResolvedValue([] as never)

      const store = usePropertyStore()
      await store.loadBlockProperties('block-1')
      const prop = store.getBlockProperty('block-1', 'non-existent')
      expect(prop).toBeUndefined()
    })
  })

  describe('loadBlockProperties', () => {
    test('加载属性并缓存', async () => {
      vi.mocked(mockClient.getProperties).mockResolvedValue([makeRustProp()] as never)

      const store = usePropertyStore()
      expect(store.loading).toBe(false)
      const props = await store.loadBlockProperties('block-1')
      expect(store.loading).toBe(false)
      expect(props.length).toBe(1)
      expect(mockClient.getProperties).toHaveBeenCalledWith('block-1')
    })
  })

  describe('loadMultiBlockProperties', () => {
    test('批量加载多个 block 的属性', async () => {
      vi.mocked(mockClient.getProperties)
        .mockResolvedValueOnce([makeRustProp()] as never)
        .mockResolvedValueOnce([makeRustProp({ id: 'prop-2', block_id: 'block-2', key: 'status', value: '"active"', type: 'text' })] as never)

      const store = usePropertyStore()
      await store.loadMultiBlockProperties(['block-1', 'block-2'])
      expect(mockClient.getProperties).toHaveBeenCalledWith('block-1')
      expect(mockClient.getProperties).toHaveBeenCalledWith('block-2')
      expect(store.getBlockProperties('block-1').length).toBe(1)
      expect(store.getBlockProperties('block-2').length).toBe(1)
    })
  })

  describe('setProperty', () => {
    test('设置属性并重新加载（select 值按 codec JSON 编码）', async () => {
      const newProp = makeRustProp({ value: '"medium"' })
      vi.mocked(mockClient.setProperty).mockResolvedValue(newProp as never)
      vi.mocked(mockClient.getProperties).mockResolvedValue([newProp] as never)

      const store = usePropertyStore()
      const result = await store.setProperty('block-1', 'priority', 'medium', 'select')
      expect(result).toMatchObject({ id: 'prop-1', key: 'priority', value: 'medium', type: 'select' })
      // codec 单源（#117）：非 string/page 类型 JSON 编码
      expect(mockClient.setProperty).toHaveBeenCalledWith('block-1', 'priority', '"medium"', 'select')
    })
  })

  describe('deleteProperty', () => {
    test('删除属性并重新加载（按 key 删除）', async () => {
      vi.mocked(mockClient.getProperties)
        .mockResolvedValueOnce([makeRustProp()] as never)
        .mockResolvedValue([] as never)

      const store = usePropertyStore()
      await store.loadBlockProperties('block-1')
      await store.deleteProperty('prop-1', 'block-1')
      expect(mockClient.deleteProperty).toHaveBeenCalledWith('block-1', 'priority')
    })
  })

  describe('updateSortOrder', () => {
    test('排序后重新加载缓存（Rust 端在 saveBlockTree 落序）', async () => {
      vi.mocked(mockClient.getProperties).mockResolvedValue([] as never)

      const store = usePropertyStore()
      await store.updateSortOrder('block-1', ['prop-1', 'prop-2'])
      expect(mockClient.getProperties).toHaveBeenCalledWith('block-1')
    })
  })

  describe('toggleHidden', () => {
    test('切换隐藏状态并重新加载', async () => {
      const hiddenProp = makeRustProp({ is_hidden: 1 })
      vi.mocked(mockClient.getProperties)
        .mockResolvedValueOnce([makeRustProp()] as never)
        .mockResolvedValue([hiddenProp] as never)
      vi.mocked(mockClient.setProperty).mockResolvedValue(hiddenProp as never)

      const store = usePropertyStore()
      await store.loadBlockProperties('block-1')
      const result = await store.toggleHidden('prop-1', 'block-1')
      expect(result.isHidden).toBe(true)
      // toggleHidden 以原值回写（setProperty 路径；string 值直通不 JSON 编码）
      expect(mockClient.setProperty).toHaveBeenCalledWith('block-1', 'priority', 'high', 'select')
    })
  })

  describe('clearBlockCache', () => {
    test('清除 block 缓存', async () => {
      vi.mocked(mockClient.getProperties).mockResolvedValue([makeRustProp()] as never)

      const store = usePropertyStore()
      await store.loadBlockProperties('block-1')
      expect(store.getBlockProperties('block-1').length).toBe(1)

      store.clearBlockCache('block-1')
      expect(store.getBlockProperties('block-1')).toEqual([])
    })
  })
})
