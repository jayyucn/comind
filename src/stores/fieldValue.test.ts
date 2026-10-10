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
  // clearAllMocks 不清除 mockImplementation；显式复位这两个 client 方法，
  // 避免前一个用例的 mockResolvedValue 泄漏到下一个（getProperties 尤其影响字段缓存）。
  vi.mocked(mockClient.getProperties).mockReset()
  vi.mocked(mockClient.getProperties).mockResolvedValue([] as never)
  vi.mocked(mockClient.setProperty).mockReset()
  vi.mocked(mockClient.setProperty).mockResolvedValue({} as never)
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
    test('设置字段值并用返回 row 就地合并缓存（string 值直通不 JSON 编码）', async () => {
      const newValue = makeFieldValue({ value_json: 'medium' })
      vi.mocked(mockClient.setProperty).mockResolvedValue(newValue as never)
      vi.mocked(mockClient.getProperties).mockResolvedValue([newValue] as never)

      const store = useFieldValueStore()
      const result = await store.setFieldValue('block-1', 'priority', 'medium', 'string')
      expect(result).toMatchObject({ id: 'prop-1', key: 'priority', value_json: 'medium', value_type: 'string' })
      // codec 单源（#117）：string 类型直通，不 JSON 编码
      expect(mockClient.setProperty).toHaveBeenCalledWith('block-1', 'priority', 'medium', 'string')
    })

    test('写入后就地合并缓存，不再全量重拉 getProperties（回显零第二往返）', async () => {
      vi.mocked(mockClient.getProperties).mockResolvedValue([] as never)
      vi.mocked(mockClient.setProperty).mockResolvedValue(makeFieldValue({ value_json: 'High' }) as never)

      const store = useFieldValueStore()
      await store.loadBlockFieldValues('block-1')
      vi.mocked(mockClient.getProperties).mockClear()

      await store.setFieldValue('block-1', 'priority', 'High', 'string')

      expect(mockClient.getProperties).not.toHaveBeenCalled()
      expect(store.getBlockFieldValue('block-1', 'priority')?.value_json).toBe('High')
    })

    test('块首次获得 status（创建任务）→ 一并补默认 priority=Low', async () => {
      const store = useFieldValueStore()
      await store.setFieldValue('block-1', 'status', 'Todo', 'string')

      expect(mockClient.setProperty).toHaveBeenCalledWith('block-1', 'status', 'Todo', 'string')
      expect(mockClient.setProperty).toHaveBeenCalledWith('block-1', 'priority', 'Low', 'string')
    })

    test('块已有 priority → 首次获得 status 时不覆盖手写值', async () => {
      vi.mocked(mockClient.getProperties).mockResolvedValue([
        makeFieldValue({ key: 'priority', value_json: 'High' }),
      ] as never)
      const store = useFieldValueStore()
      await store.loadBlockFieldValues('block-1')

      await store.setFieldValue('block-1', 'status', 'Todo', 'string')

      expect(mockClient.setProperty).not.toHaveBeenCalledWith('block-1', 'priority', 'Low', 'string')
    })

    test('块已有 status（状态切换，非创建）→ 不补 priority', async () => {
      vi.mocked(mockClient.getProperties).mockResolvedValue([
        makeFieldValue({ key: 'status', value_json: 'Doing' }),
      ] as never)
      const store = useFieldValueStore()
      await store.loadBlockFieldValues('block-1')

      await store.setFieldValue('block-1', 'status', 'Done', 'string')

      expect(mockClient.setProperty).not.toHaveBeenCalledWith('block-1', 'priority', 'Low', 'string')
    })
  })

  describe('deleteFieldValue', () => {
    test('删除字段值并就地移除缓存（按 key 删除，不再全量重拉）', async () => {
      vi.mocked(mockClient.getProperties).mockResolvedValue([makeFieldValue()] as never)

      const store = useFieldValueStore()
      await store.loadBlockFieldValues('block-1')
      vi.mocked(mockClient.getProperties).mockClear()

      await store.deleteFieldValue('prop-1', 'block-1')
      expect(mockClient.deleteProperty).toHaveBeenCalledWith('block-1', 'priority')
      expect(mockClient.getProperties).not.toHaveBeenCalled()
      expect(store.getBlockFieldValue('block-1', 'priority')).toBeUndefined()
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
