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
  getRelationshipColor
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
      const r = getPredefinedRelationship('parent')
      expect(r).toEqual({
        type: 'parent',
        inverse: 'child',
        label: '父级',
        inverseLabel: '子级',
        color: '#1890ff'
      })
    })

    it('反向 type 返回反向后的 label/inverseLabel', () => {
      const r = getPredefinedRelationship('child')
      expect(r).toEqual({
        type: 'parent',
        inverse: 'child',
        label: '子级',
        inverseLabel: '父级',
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
      const g = getGroupByType('parent')
      expect(g?.type).toBe('parent')
    })

    it('反向 type 找到组', () => {
      const g = getGroupByType('child')
      expect(g?.type).toBe('parent')
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
      await softDelete('rt_seed_parent')
      expect(getGroupByType('parent')).toBeUndefined()
    })
  })

  describe('getDirectionInGroup', () => {
    it('正向 → forward', () => {
      expect(getDirectionInGroup('parent')).toBe('forward')
    })

    it('反向 → inverse', () => {
      expect(getDirectionInGroup('child')).toBe('inverse')
    })

    it('自反 → forward', () => {
      expect(getDirectionInGroup('related')).toBe('forward')
    })

    it('不存在 → null', () => {
      expect(getDirectionInGroup('not-exist')).toBeNull()
    })
  })

  describe('getInverseRelationshipType', () => {
    it('parent → child', () => {
      expect(getInverseRelationshipType('parent')).toBe('child')
    })

    it('child → parent', () => {
      expect(getInverseRelationshipType('child')).toBe('parent')
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
      expect(getRelationshipLabel('parent')).toBe('父级')
    })

    it('返回反向中文标签', () => {
      expect(getRelationshipLabel('child')).toBe('子级')
    })

    it('不存在返回 type 字符串', () => {
      expect(getRelationshipLabel('not-exist')).toBe('not-exist')
    })

    it('软删的 type 返回 "<label> (已删除)"', async () => {
      const { softDelete, _resetForTest, load } = useRelationshipTypes()
      _resetForTest()
      await load()
      await softDelete('rt_seed_parent')
      expect(getRelationshipLabel('parent')).toBe('父级 (已删除)')
    })
  })

  describe('getRelationshipColor', () => {
    it('返回预定义颜色', () => {
      expect(getRelationshipColor('parent')).toBe('#1890ff')
    })

    it('反向 type 同色', () => {
      expect(getRelationshipColor('child')).toBe('#1890ff')
    })

    it('不存在返回默认灰', () => {
      expect(getRelationshipColor('not-exist')).toBe('#8c8c8c')
    })

    it('软删的 type 返回灰色 #bfbfbf', async () => {
      const { softDelete, _resetForTest, load } = useRelationshipTypes()
      _resetForTest()
      await load()
      await softDelete('rt_seed_parent')
      expect(getRelationshipColor('parent')).toBe('#bfbfbf')
    })
  })
})
