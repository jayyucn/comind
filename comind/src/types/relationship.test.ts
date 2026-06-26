// d:\comind\comind\src\types\relationship.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '../storage/db'
import {
  getPredefinedRelationship,
  getGroupByType,
  getDirectionInGroup,
  getInverseRelationshipType,
  getRelationshipLabel,
  getRelationshipColor,
  getRelationshipStrength
} from './relationship'
import { useRelationshipTypes } from '../composables/useRelationshipTypes'

describe('relationship（运行时配置）', () => {
  beforeEach(async () => {
    // fake-indexeddb 跨测试持久化，软删状态会泄漏；与 useRelationshipTypes.test.ts 一致地清表
    await db.relationshipTypes.clear()
    const { _resetForTest, load } = useRelationshipTypes()
    _resetForTest()
    await load()
  })

  describe('getPredefinedRelationship', () => {
    it('正向 type 返回组信息', () => {
      const r = getPredefinedRelationship('is-a')
      expect(r).toEqual({
        type: 'is-a',
        inverse: 'has-instance',
        label: '是一个',
        inverseLabel: '有实例',
        color: '#1890ff'
      })
    })

    it('反向 type 返回反向后的 label/inverseLabel', () => {
      const r = getPredefinedRelationship('has-instance')
      expect(r).toEqual({
        type: 'is-a',
        inverse: 'has-instance',
        label: '有实例',
        inverseLabel: '是一个',
        color: '#1890ff'
      })
    })

    it('自反 type 返回自身', () => {
      const r = getPredefinedRelationship('related')
      expect(r?.type).toBe('related')
      expect(r?.inverse).toBeNull()
    })

    it('不存在返回 undefined', () => {
      expect(getPredefinedRelationship('not-exist')).toBeUndefined()
    })
  })

  describe('getGroupByType', () => {
    it('正向 type 找到组', () => {
      const g = getGroupByType('is-a')
      expect(g?.type).toBe('is-a')
    })

    it('反向 type 找到组', () => {
      const g = getGroupByType('has-instance')
      expect(g?.type).toBe('is-a')
    })

    it('自反 type 找到自身组', () => {
      const g = getGroupByType('related')
      expect(g?.type).toBe('related')
    })

    it('不存在返回 undefined', () => {
      expect(getGroupByType('not-exist')).toBeUndefined()
    })

    it('软删后不再被找到（items 不含已删）', async () => {
      const { softDelete, _resetForTest, load } = useRelationshipTypes()
      _resetForTest()
      await load()
      await softDelete('rt_seed_is-a')
      expect(getGroupByType('is-a')).toBeUndefined()
    })
  })

  describe('getDirectionInGroup', () => {
    it('正向 → forward', () => {
      expect(getDirectionInGroup('is-a')).toBe('forward')
    })

    it('反向 → inverse', () => {
      expect(getDirectionInGroup('has-instance')).toBe('inverse')
    })

    it('自反 → forward', () => {
      expect(getDirectionInGroup('related')).toBe('forward')
    })

    it('不存在 → null', () => {
      expect(getDirectionInGroup('not-exist')).toBeNull()
    })
  })

  describe('getInverseRelationshipType', () => {
    it('is-a → has-instance', () => {
      expect(getInverseRelationshipType('is-a')).toBe('has-instance')
    })

    it('has-instance → is-a', () => {
      expect(getInverseRelationshipType('has-instance')).toBe('is-a')
    })

    it('自反 → 自身', () => {
      expect(getInverseRelationshipType('related')).toBe('related')
    })

    it('不存在 → null', () => {
      expect(getInverseRelationshipType('not-exist')).toBeNull()
    })
  })

  describe('getRelationshipLabel', () => {
    it('返回正向中文标签', () => {
      expect(getRelationshipLabel('is-a')).toBe('是一个')
    })

    it('返回反向中文标签', () => {
      expect(getRelationshipLabel('has-instance')).toBe('有实例')
    })

    it('不存在返回 type 字符串', () => {
      expect(getRelationshipLabel('not-exist')).toBe('not-exist')
    })

    it('软删的 type 返回 "<label> (已删除)"', async () => {
      const { softDelete, _resetForTest, load } = useRelationshipTypes()
      _resetForTest()
      await load()
      await softDelete('rt_seed_is-a')
      expect(getRelationshipLabel('is-a')).toBe('是一个 (已删除)')
    })
  })

  describe('getRelationshipColor', () => {
    it('返回预定义颜色', () => {
      expect(getRelationshipColor('is-a')).toBe('#1890ff')
    })

    it('反向 type 同色', () => {
      expect(getRelationshipColor('has-instance')).toBe('#1890ff')
    })

    it('不存在返回默认灰', () => {
      expect(getRelationshipColor('not-exist')).toBe('#8c8c8c')
    })

    it('软删的 type 返回灰色 #bfbfbf', async () => {
      const { softDelete, _resetForTest, load } = useRelationshipTypes()
      _resetForTest()
      await load()
      await softDelete('rt_seed_is-a')
      expect(getRelationshipColor('is-a')).toBe('#bfbfbf')
    })
  })

  describe('getRelationshipStrength', () => {
    it('返回预定义强度', () => {
      expect(getRelationshipStrength('is-a')).toBe('strong')
      expect(getRelationshipStrength('part-of')).toBe('strong')
      expect(getRelationshipStrength('causes')).toBe('strong')
      expect(getRelationshipStrength('uses')).toBe('medium')
      expect(getRelationshipStrength('supports')).toBe('medium')
      expect(getRelationshipStrength('contradicts')).toBe('medium')
      expect(getRelationshipStrength('related')).toBe('weak')
    })

    it('反向 type 同强度', () => {
      expect(getRelationshipStrength('has-instance')).toBe('strong')
      expect(getRelationshipStrength('used-by')).toBe('medium')
    })

    it('不存在返回 medium', () => {
      expect(getRelationshipStrength('not-exist')).toBe('medium')
    })
  })
})
