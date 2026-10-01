import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFieldValueStore } from './fieldValue'
import { decodeFieldValueData } from '../utils/field-value-codec'
import type { CoreClient } from '../wasm/client'

// Store 已全面委托 Rust CoreClient（4.2/S6 迁移）；此处 mock client 验证
// store 的缓存/映射/编解码编排。Rust 形状（snake_case、deleted_at 为 null|时间戳）。
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

function makeFieldValue(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prop-1',
    block_id: 'block-1',
    field_definition_id: 'fd-1',
    key: 'priority',
    value_json: 'high',
    value_type: 'string',
    seq: 0,
    created_at: Date.now(),
    updated_at: Date.now(),
    version: 0,
    deleted_at: null,
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('useFieldValueStore', () => {
  describe('builtInFields', () => {
    test('返回内置字段定义', () => {
      const store = useFieldValueStore()
      expect(store.builtInFields.length).toBeGreaterThan(0)
    })
  })

  describe('getFieldDef', () => {
    test('获取字段定义', () => {
      const store = useFieldValueStore()
      const def = store.getFieldDef('priority')
      expect(def).toBeDefined()
      expect(def?.key).toBe('priority')
    })

    test('获取不存在的字段定义返回 undefined', () => {
      const store = useFieldValueStore()
      const def = store.getFieldDef('non-existent')
      expect(def).toBeUndefined()
    })
  })

  describe('getBlockFieldValues', () => {
    test('初始返回空数组', () => {
      const store = useFieldValueStore()
      const values = store.getBlockFieldValues('block-1')
      expect(values).toEqual([])
    })

    test('获取已加载的字段值', async () => {
      vi.mocked(mockClient.getProperties).mockResolvedValue([makeFieldValue()] as never)

      const store = useFieldValueStore()
      await store.loadBlockFieldValues('block-1')
      const values = store.getBlockFieldValues('block-1')
      expect(values.length).toBe(1)
    })
  })

  describe('getBlockFieldValue', () => {
    test('通过 key 获取字段值', async () => {
      vi.mocked(mockClient.getProperties).mockResolvedValue([makeFieldValue()] as never)

      const store = useFieldValueStore()
      await store.loadBlockFieldValues('block-1')
      const value = store.getBlockFieldValue('block-1', 'priority')
      expect(value?.key).toBe('priority')
      expect(decodeFieldValueData(value!.value_json, value!.value_type)).toBe('high')
    })

    test('获取不存在的字段值返回 undefined', async () => {
      vi.mocked(mockClient.getProperties).mockResolvedValue([] as never)

      const store = useFieldValueStore()
      await store.loadBlockFieldValues('block-1')
      const value = store.getBlockFieldValue('block-1', 'non-existent')
      expect(value).toBeUndefined()
    })
  })

  describe('loadBlockFieldValues', () => {
    test('加载字段值并缓存', async () => {
      vi.mocked(mockClient.getProperties).mockResolvedValue([makeFieldValue()] as never)

      const store = useFieldValueStore()
      expect(store.loading).toBe(false)
      const values = await store.loadBlockFieldValues('block-1')
      expect(store.loading).toBe(false)
      expect(values.length).toBe(1)
      expect(mockClient.getProperties).toHaveBeenCalledWith('block-1')
    })
  })

  describe('loadMultiBlockFieldValues', () => {
    test('批量加载多个 block 的字段值', async () => {
      vi.mocked(mockClient.getProperties)
        .mockResolvedValueOnce([makeFieldValue()] as never)
        .mockResolvedValueOnce([makeFieldValue({ id: 'prop-2', block_id: 'block-2', key: 'status', value_json: 'active', value_type: 'string' })] as never)

      const store = useFieldValueStore()
      await store.loadMultiBlockFieldValues(['block-1', 'block-2'])
      expect(mockClient.getProperties).toHaveBeenCalledWith('block-1')
      expect(mockClient.getProperties).toHaveBeenCalledWith('block-2')
      expect(store.getBlockFieldValues('block-1').length).toBe(1)
      expect(store.getBlockFieldValues('block-2').length).toBe(1)
    })
  })

  describe('setFieldValue', () => {
    test('设置字段值并重新加载（string 值直通不 JSON 编码）', async () => {
      const newValue = makeFieldValue({ value_json: 'medium' })
      vi.mocked(mockClient.setProperty).mockResolvedValue(newValue as never)
      vi.mocked(mockClient.getProperties).mockResolvedValue([newValue] as never)

      const store = useFieldValueStore()
      const result = await store.setFieldValue('block-1', 'priority', 'medium', 'string')
      expect(result).toMatchObject({ id: 'prop-1', key: 'priority', value_json: 'medium', value_type: 'string' })
      // codec 单源（#117）：string 类型直通，不 JSON 编码
      expect(mockClient.setProperty).toHaveBeenCalledWith('block-1', 'priority', 'medium', 'string')
    })
  })

  describe('deleteFieldValue', () => {
    test('删除字段值并重新加载（按 key 删除）', async () => {
      vi.mocked(mockClient.getProperties)
        .mockResolvedValueOnce([makeFieldValue()] as never)
        .mockResolvedValue([] as never)

      const store = useFieldValueStore()
      await store.loadBlockFieldValues('block-1')
      await store.deleteFieldValue('prop-1', 'block-1')
      expect(mockClient.deleteProperty).toHaveBeenCalledWith('block-1', 'priority')
    })
  })

  describe('clearBlockCache', () => {
    test('清除 block 缓存', async () => {
      vi.mocked(mockClient.getProperties).mockResolvedValue([makeFieldValue()] as never)

      const store = useFieldValueStore()
      await store.loadBlockFieldValues('block-1')
      expect(store.getBlockFieldValues('block-1').length).toBe(1)

      store.clearBlockCache('block-1')
      expect(store.getBlockFieldValues('block-1')).toEqual([])
    })
  })
})
