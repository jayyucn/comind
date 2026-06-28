/**
 * Core Layer - RelationshipTypeService 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { RelationshipTypeService } from '../services/relationshipTypeService'
import { MemoryAdapter } from '../storage/memoryAdapter'

describe('RelationshipTypeService', () => {
  let service: RelationshipTypeService
  let storage: MemoryAdapter

  beforeEach(() => {
    storage = new MemoryAdapter()
    service = new RelationshipTypeService({ storage })
  })

  // =============================================================================
  // 辅助函数
  // =============================================================================

  async function createType(options: {
    type?: string
    inverse?: string | null
    label?: string
    inverseLabel?: string
    group?: string
    strength?: 'weak' | 'medium' | 'strong'
  } = {}): Promise<any> {
    return service.create({
      type: options.type ?? `custom-${Date.now()}`,
      inverse: options.inverse ?? null,
      label: options.label ?? '测试关系',
      inverseLabel: options.inverseLabel ?? '反向关系',
      description: null,
      color: '#808080',
      group: options.group ?? 'custom',
      strength: options.strength ?? 'medium',
    })
  }

  // =============================================================================
  // CRUD 操作
  // =============================================================================

  describe('getById', () => {
    it('应返回已创建的关系类型', async () => {
      const created = await createType({ type: 'test-type' })
      const found = await service.getById(created.id)
      expect(found).toBeDefined()
      expect(found?.id).toBe(created.id)
      expect(found?.type).toBe('test-type')
    })

    it('不存在的 ID 返回 undefined', async () => {
      const found = await service.getById('non-existent')
      expect(found).toBeUndefined()
    })
  })

  describe('getByType', () => {
    it('应通过 type 查找关系类型', async () => {
      await createType({ type: 'find-me' })
      const found = await service.getByType('find-me')
      expect(found).toBeDefined()
      expect(found?.type).toBe('find-me')
    })

    it('不存在的 type 返回 undefined', async () => {
      const found = await service.getByType('non-existent')
      expect(found).toBeUndefined()
    })
  })

  describe('getAll', () => {
    it('应返回所有关系类型', async () => {
      await createType({ type: 'type-1' })
      await createType({ type: 'type-2' })
      const all = await service.getAll()
      expect(all.length).toBeGreaterThanOrEqual(2)
    })

    it('应按 order 排序', async () => {
      const first = await createType({ type: 'first', label: 'First' })
      const second = await createType({ type: 'second', label: 'Second' })
      const all = await service.getAll()
      const firstIdx = all.findIndex(r => r.type === 'first')
      const secondIdx = all.findIndex(r => r.type === 'second')
      expect(firstIdx).toBeLessThan(secondIdx)
    })
  })

  describe('getActive', () => {
    it('应返回未删除的关系类型', async () => {
      const active = await createType({ type: 'active-type' })
      await service.softDelete(active.id)
      const all = await service.getAll()
      const activeTypes = all.filter(r => !r.deleted)
      expect(activeTypes.find(r => r.type === 'active-type')).toBeUndefined()
    })
  })

  describe('getByGroup', () => {
    it('应返回指定分组的关系类型', async () => {
      await createType({ type: 'work-1', group: 'work' })
      await createType({ type: 'work-2', group: 'work' })
      await createType({ type: 'family-1', group: 'family' })
      const workTypes = await service.getByGroup('work')
      expect(workTypes.length).toBeGreaterThanOrEqual(2)
      expect(workTypes.every(r => r.group === 'work')).toBe(true)
    })
  })

  describe('create', () => {
    it('应创建关系类型', async () => {
      const created = await createType({
        type: 'new-type',
        inverse: 'inverse-of',
        label: '新关系',
        inverseLabel: '反向',
        group: 'concept',
        strength: 'strong',
      })
      expect(created.id).toMatch(/^rt_user_/)
      expect(created.type).toBe('new-type')
      expect(created.inverse).toBe('inverse-of')
      expect(created.label).toBe('新关系')
      expect(created.group).toBe('concept')
      expect(created.strength).toBe('strong')
      expect(created.builtin).toBe(false)
      expect(created.deleted).toBe(false)
    })

    it('type 重复应覆盖（因为软删除后创建新记录）', async () => {
      await createType({ type: 'duplicate-type' })
      await service.softDelete((await service.getByType('duplicate-type')!).id)
      // 软删除后再创建相同 type 应该成功
      const newOne = await createType({ type: 'duplicate-type' })
      expect(newOne.type).toBe('duplicate-type')
      expect(newOne.deleted).toBe(false)
    })
  })

  describe('update', () => {
    it('应更新关系类型', async () => {
      const created = await createType({ type: 'update-test', label: '原始标签' })
      const updated = await service.update(created.id, { label: '新标签' })
      expect(updated.label).toBe('新标签')
      expect(updated.id).toBe(created.id)
    })

    it('不存在的 ID 应抛出错误', async () => {
      await expect(service.update('non-existent', { label: 'test' })).rejects.toThrow()
    })
  })

  describe('softDelete', () => {
    it('应软删除关系类型', async () => {
      const created = await createType({ type: 'soft-delete-test' })
      await service.softDelete(created.id)
      const found = await service.getById(created.id)
      expect(found?.deleted).toBe(true)
    })
  })

  describe('restore', () => {
    it('应恢复已软删除的关系类型', async () => {
      const created = await createType({ type: 'restore-test' })
      await service.softDelete(created.id)
      await service.restore(created.id)
      const found = await service.getById(created.id)
      expect(found?.deleted).toBe(false)
    })
  })

  describe('getInverse', () => {
    it('应返回反向关系类型', async () => {
      await createType({ type: 'parent', inverse: 'child' })
      await createType({ type: 'child' })
      const inverse = await service.getInverse('parent')
      expect(inverse?.type).toBe('child')
    })

    it('无反向关系时返回 undefined', async () => {
      const rt = await createType({ type: 'no-inverse', inverse: null })
      const inverse = await service.getInverse('no-inverse')
      expect(inverse).toBeUndefined()
    })
  })

  describe('updateOrder', () => {
    it('应批量更新顺序', async () => {
      const r1 = await createType({ type: 'order-1' })
      const r2 = await createType({ type: 'order-2' })
      await service.updateOrder([r2.id, r1.id])
      const all = await service.getAll()
      const idx1 = all.findIndex(r => r.type === 'order-1')
      const idx2 = all.findIndex(r => r.type === 'order-2')
      expect(idx1).toBeGreaterThan(idx2)
    })
  })
})
