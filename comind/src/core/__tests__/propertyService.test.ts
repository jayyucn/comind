/**
 * Core Layer - PropertyService 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { PropertyService } from '../services/propertyService'
import { MemoryAdapter } from '../storage/memoryAdapter'
import type { Property } from '../types'

describe('PropertyService', () => {
  let service: PropertyService
  let storage: MemoryAdapter

  beforeEach(() => {
    storage = new MemoryAdapter()
    service = new PropertyService({ storage })
  })

  // =============================================================================
  // CRUD 操作
  // =============================================================================

  describe('getByBlockId', () => {
    it('应返回 Block 的所有属性', async () => {
      await service.setProperty('block-1', 'name', 'Test')
      await service.setProperty('block-1', 'status', 'done')
      await service.setProperty('block-2', 'name', 'Other')

      const properties = await service.getByBlockId('block-1')
      expect(properties.length).toBe(2)
      expect(properties.every(p => p.blockId === 'block-1')).toBe(true)
    })

    it('无属性返回空数组', async () => {
      const properties = await service.getByBlockId('non-existent')
      expect(properties.length).toBe(0)
    })

    it('不应返回已删除的属性', async () => {
      await service.setProperty('block-1', 'status', 'done')
      await service.deleteProperty('block-1', 'status')

      const properties = await service.getByBlockId('block-1')
      expect(properties.length).toBe(0)
    })
  })

  describe('getByKey', () => {
    it('应返回指定 key 的属性', async () => {
      await service.setProperty('block-1', 'name', 'Test')
      await service.setProperty('block-1', 'status', 'done')

      const property = await service.getByKey('block-1', 'name')
      expect(property).toBeDefined()
      expect(property?.value).toBe('Test')
    })

    it('不存在的 key 返回 undefined', async () => {
      const property = await service.getByKey('block-1', 'non-existent')
      expect(property).toBeUndefined()
    })
  })

  describe('setProperty', () => {
    it('应创建新属性', async () => {
      const property = await service.setProperty('block-1', 'name', 'Test')

      expect(property.id).toBeDefined()
      expect(property.blockId).toBe('block-1')
      expect(property.key).toBe('name')
      expect(property.value).toBe('Test')
    })

    it('已存在应更新属性', async () => {
      await service.setProperty('block-1', 'name', 'Original')
      const updated = await service.setProperty('block-1', 'name', 'Updated')

      const properties = await service.getByBlockId('block-1')
      expect(properties.length).toBe(1)
      expect(updated.value).toBe('Updated')
    })

    it('应推断属性类型', async () => {
      const numberProp = await service.setProperty('block-1', 'count', 42)
      expect(numberProp.type).toBe('number')

      const boolProp = await service.setProperty('block-1', 'enabled', true)
      expect(boolProp.type).toBe('boolean')
    })

    it('应使用提供的类型', async () => {
      const prop = await service.setProperty('block-1', 'custom', 'value', 'string')
      expect(prop.type).toBe('string')
    })
  })

  describe('deleteProperty', () => {
    it('应删除指定属性', async () => {
      await service.setProperty('block-1', 'name', 'Test')
      await service.deleteProperty('block-1', 'name')

      const property = await service.getByKey('block-1', 'name')
      expect(property).toBeUndefined()
    })

    it('删除不存在的属性不抛出错误', async () => {
      await expect(service.deleteProperty('block-1', 'non-existent')).resolves.not.toThrow()
    })
  })

  describe('deleteByBlockId', () => {
    it('应删除 Block 的所有属性', async () => {
      await service.setProperty('block-1', 'name', 'Test')
      await service.setProperty('block-1', 'status', 'done')

      await service.deleteByBlockId('block-1')

      const properties = await service.getByBlockId('block-1')
      expect(properties.length).toBe(0)
    })

    it('不影响其他 Block 的属性', async () => {
      await service.setProperty('block-1', 'name', 'Test')
      await service.setProperty('block-2', 'name', 'Other')

      await service.deleteByBlockId('block-1')

      const properties = await service.getByBlockId('block-2')
      expect(properties.length).toBe(1)
    })
  })

  // =============================================================================
  // 类型推断
  // =============================================================================

  describe('inferType', () => {
    it('应识别布尔值', () => {
      expect(service.inferType(true)).toEqual({ type: 'boolean', value: true })
      expect(service.inferType(false)).toEqual({ type: 'boolean', value: false })
    })

    it('应识别数字', () => {
      expect(service.inferType(42)).toEqual({ type: 'number', value: 42 })
      expect(service.inferType(3.14)).toEqual({ type: 'number', value: 3.14 })
    })

    it('应识别数组', () => {
      const result = service.inferType(['a', 'b', 'c'])
      expect(result.type).toBe('array')
      expect(result.value).toEqual(['a', 'b', 'c'])
    })

    it('应识别日期格式 YYYY-MM-DD', () => {
      const result = service.inferType('2024-01-15')
      expect(result.type).toBe('date')
    })

    it('应识别日期时间格式', () => {
      const result = service.inferType('2024-01-15T10:30:00')
      expect(result.type).toBe('datetime')
    })

    it('应识别布尔值字符串', () => {
      expect(service.inferType('true')).toEqual({ type: 'boolean', value: true })
      expect(service.inferType('false')).toEqual({ type: 'boolean', value: false })
    })

    it('应识别数字字符串', () => {
      expect(service.inferType('42')).toEqual({ type: 'number', value: 42 })
      expect(service.inferType('3.14')).toEqual({ type: 'number', value: 3.14 })
    })

    it('其他字符串返回 string 类型', () => {
      expect(service.inferType('hello')).toEqual({ type: 'string', value: 'hello' })
      expect(service.inferType('not a date')).toEqual({ type: 'string', value: 'not a date' })
    })
  })

  // =============================================================================
  // 属性解析
  // =============================================================================

  describe('parseProperties', () => {
    it('应解析简单属性', () => {
      const props = service.parseProperties('status:: done')
      expect(props).toHaveProperty('status')
      expect(props.status).toBe('done')
    })

    it('应解析多个属性', () => {
      const props = service.parseProperties('name:: Test\nstatus:: done')
      expect(props).toHaveProperty('name')
      expect(props).toHaveProperty('status')
      expect(props.name).toBe('Test')
      expect(props.status).toBe('done')
    })

    it('应解析带空格的属性值', () => {
      const props = service.parseProperties('title:: Hello World')
      expect(props.title).toBe('Hello World')
    })

    it('应处理没有属性值的情况', () => {
      const props = service.parseProperties('empty::')
      expect(props.empty).toBe('')
    })

    it('应解析数字值', () => {
      const props = service.parseProperties('count:: 42')
      expect(props.count).toBe(42)
    })

    it('应解析布尔值', () => {
      const props = service.parseProperties('enabled:: true')
      expect(props.enabled).toBe(true)
    })

    it('应忽略非属性行', () => {
      const props = service.parseProperties('Hello world\nstatus:: done')
      expect(props).toHaveProperty('status')
      expect(props).not.toHaveProperty('Hello')
    })

    it('无属性返回空对象', () => {
      const props = service.parseProperties('No properties here')
      expect(Object.keys(props).length).toBe(0)
    })

    it('空字符串返回空对象', () => {
      const props = service.parseProperties('')
      expect(Object.keys(props).length).toBe(0)
    })
  })

  // =============================================================================
  // 属性同步
  // =============================================================================

  describe('syncBlockProperties', () => {
    it('应添加新属性', async () => {
      await service.syncBlockProperties('block-1', 'name:: Test')

      const properties = await service.getByBlockId('block-1')
      expect(properties.length).toBe(1)
      expect(properties[0].key).toBe('name')
      expect(properties[0].value).toBe('Test')
    })

    it('应删除不再存在的属性', async () => {
      await service.setProperty('block-1', 'old', 'value')

      await service.syncBlockProperties('block-1', 'name:: Test')

      const properties = await service.getByBlockId('block-1')
      expect(properties.length).toBe(1)
      expect(properties[0].key).toBe('name')
    })

    it('应保留仍然存在的属性', async () => {
      await service.setProperty('block-1', 'name', 'Original')
      await service.setProperty('block-1', 'keep', 'me')

      await service.syncBlockProperties('block-1', 'name:: Updated\nkeep:: me')

      const properties = await service.getByBlockId('block-1')
      expect(properties.length).toBe(2)

      const nameProp = properties.find(p => p.key === 'name')
      expect(nameProp?.value).toBe('Updated')

      const keepProp = properties.find(p => p.key === 'keep')
      expect(keepProp?.value).toBe('me')
    })

    it('应处理复杂内容', async () => {
      const content = `这是一个 Block 的内容
name:: Test Block
status:: done
priority:: 1`

      await service.syncBlockProperties('block-1', content)

      const properties = await service.getByBlockId('block-1')
      expect(properties.length).toBe(3)
      expect(properties.map(p => p.key)).toContain('name')
      expect(properties.map(p => p.key)).toContain('status')
      expect(properties.map(p => p.key)).toContain('priority')
    })
  })
})
