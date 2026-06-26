import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '../storage/db'
import { useRelationshipTypes, validateRelationshipTypeInput } from './useRelationshipTypes'

describe('useRelationshipTypes', () => {
  beforeEach(async () => {
    await db.relationshipTypes.clear()
    // 清除模块级 state
    const { _resetForTest } = useRelationshipTypes()
    _resetForTest()
  })

  afterEach(async () => {
    await db.relationshipTypes.clear()
  })

  describe('load', () => {
    it('空表时种入 8 条种子记录', async () => {
      const { load, all } = useRelationshipTypes()
      await load()
      expect(all.value).toHaveLength(8)
      expect(all.value[0].type).toBe('is-a')
      expect(all.value[0].id).toBe('rt_seed_is-a')
      expect(all.value[0].order).toBe(0)
      expect(all.value[0].builtin).toBe(true)
      expect(all.value[0].strength).toBe('strong')
      expect(all.value.find(r => r.type === 'related')?.strength).toBe('weak')
      expect(all.value.find(r => r.type === 'uses')?.strength).toBe('medium')
    })

    it('非空时不覆盖已有记录', async () => {
      // 预置一条用户修改过的种子
      await db.relationshipTypes.put({
        id: 'rt_seed_is-a',
        type: 'is-a',
        inverse: 'has-instance',
        label: '是一个（已修改）',
        inverseLabel: '有实例（已修改）',
        color: '#000000',
        strength: 'strong',
        order: 0,
        deleted: false,
        builtin: true
      })
      const { load, all } = useRelationshipTypes()
      await load()
      const isA = all.value.find(r => r.type === 'is-a')
      expect(isA?.label).toBe('是一个（已修改）')
      // 其余 7 条种子应该被补齐
      expect(all.value).toHaveLength(8)
    })

    it('非空时为缺失的种子补齐', async () => {
      // 预置前 2 条种子
      await db.relationshipTypes.put({ id: 'rt_seed_is-a', type: 'is-a', inverse: 'has-instance', label: '是一个', inverseLabel: '有实例', color: '#1890ff', strength: 'strong', order: 0, deleted: false, builtin: true })
      await db.relationshipTypes.put({ id: 'rt_seed_part-of', type: 'part-of', inverse: 'has-part', label: '部分于', inverseLabel: '有部分', color: '#13c2c2', strength: 'strong', order: 1, deleted: false, builtin: true })
      const { load, all } = useRelationshipTypes()
      await load()
      expect(all.value).toHaveLength(8)
    })

    it('load 后 loaded 变为 true', async () => {
      const { load, loaded } = useRelationshipTypes()
      expect(loaded.value).toBe(false)
      await load()
      expect(loaded.value).toBe(true)
    })
  })

  describe('items（菜单用）', () => {
    it('过滤掉已软删的', async () => {
      const { load, create, softDelete, items } = useRelationshipTypes()
      await load()
      const custom = await create({ type: 'custom', inverse: null, label: '自定义', inverseLabel: '自定义', color: '#111111', strength: 'medium' })
      expect(items.value.find(r => r.type === 'custom')).toBeTruthy()
      await softDelete(custom.id)
      expect(items.value.find(r => r.type === 'custom')).toBeUndefined()
      // all 仍能看到
      const { all } = useRelationshipTypes()
      expect(all.value.find(r => r.type === 'custom')).toBeTruthy()
    })

    it('按 order 升序排列', async () => {
      const { load, items } = useRelationshipTypes()
      await load()
      const orders = items.value.map(r => r.order)
      expect(orders).toEqual([...orders].sort((a, b) => a - b))
    })
  })

  describe('create', () => {
    it('成功路径：写入 Dexie + 更新 state', async () => {
      const { load, create, all } = useRelationshipTypes()
      await load()
      const created = await create({ type: 'blocker', inverse: 'blocked-by', label: '阻塞', inverseLabel: '被阻塞', color: '#ff0000', strength: 'medium' })
      expect(created.id).toMatch(/^rt_user_/)
      expect(created.order).toBe(8)  // 8 种子后
      expect(created.builtin).toBe(false)
      expect(created.strength).toBe('medium')
      expect(all.value.find(r => r.id === created.id)).toBeTruthy()
    })

    it('type 重复时抛出错误', async () => {
      const { load, create } = useRelationshipTypes()
      await load()
      await expect(create({ type: 'is-a', inverse: null, label: 'X', inverseLabel: 'X', color: '#000', strength: 'medium' })).rejects.toThrow(/已存在/)
    })

    it('type 与已软删记录冲突时允许创建', async () => {
      const { load, create, softDelete } = useRelationshipTypes()
      await load()
      const c1 = await create({ type: 'tmp', inverse: null, label: 'A', inverseLabel: 'A', color: '#000', strength: 'medium' })
      await softDelete(c1.id)
      const c2 = await create({ type: 'tmp', inverse: null, label: 'B', inverseLabel: 'B', color: '#000', strength: 'medium' })
      expect(c2.id).not.toBe(c1.id)
    })

    it('label 为空时抛出错误', async () => {
      const { load, create } = useRelationshipTypes()
      await load()
      await expect(create({ type: 'x', inverse: null, label: '', inverseLabel: 'x', color: '#000', strength: 'medium' })).rejects.toThrow(/label/i)
    })

    it('color 格式错时抛出错误', async () => {
      const { load, create } = useRelationshipTypes()
      await load()
      await expect(create({ type: 'x', inverse: null, label: 'x', inverseLabel: 'x', color: 'red', strength: 'medium' })).rejects.toThrow(/color/i)
    })

    it('type 不符合正则时抛出错误', async () => {
      const { load, create } = useRelationshipTypes()
      await load()
      await expect(create({ type: 'Has-Cap', inverse: null, label: 'x', inverseLabel: 'x', color: '#000', strength: 'medium' })).rejects.toThrow(/type/i)
    })
  })

  describe('update', () => {
    it('成功路径：局部更新', async () => {
      const { load, update, all } = useRelationshipTypes()
      await load()
      const isA = all.value.find(r => r.type === 'is-a')!
      await update(isA.id, { label: '上级' })
      const updated = all.value.find(r => r.id === isA.id)!
      expect(updated.label).toBe('上级')
    })

    it('type 改为与其他记录冲突时抛出错误', async () => {
      const { load, update, all } = useRelationshipTypes()
      await load()
      const isA = all.value.find(r => r.type === 'is-a')!
      await expect(update(isA.id, { type: 'related' })).rejects.toThrow(/已存在/)
    })

    it('能更新 strength 字段', async () => {
      const { load, update, all } = useRelationshipTypes()
      await load()
      const isA = all.value.find(r => r.type === 'is-a')!
      expect(isA.strength).toBe('strong')
      await update(isA.id, { strength: 'weak' })
      const updated = all.value.find(r => r.id === isA.id)!
      expect(updated.strength).toBe('weak')
    })
  })

  describe('softDelete + restore', () => {
    it('softDelete 设置 deleted=true', async () => {
      const { load, softDelete, all } = useRelationshipTypes()
      await load()
      const isA = all.value.find(r => r.type === 'is-a')!
      await softDelete(isA.id)
      expect(all.value.find(r => r.id === isA.id)?.deleted).toBe(true)
    })

    it('restore 恢复 deleted=false', async () => {
      const { load, softDelete, restore, all } = useRelationshipTypes()
      await load()
      const isA = all.value.find(r => r.type === 'is-a')!
      await softDelete(isA.id)
      await restore(isA.id)
      expect(all.value.find(r => r.id === isA.id)?.deleted).toBe(false)
    })
  })

  describe('reorder', () => {
    it('按传入 id 顺序重写 order 字段', async () => {
      const { load, reorder, all } = useRelationshipTypes()
      await load()
      const ids = all.value.map(r => r.id)
      // 逆序
      const reversed = [...ids].reverse()
      await reorder(reversed)
      const after = all.value.map(r => r.id)
      expect(after).toEqual(reversed)
      const orders = all.value.map(r => r.order)
      expect(orders).toEqual([...orders].sort((a, b) => a - b))
    })
  })
})

describe('validateRelationshipTypeInput', () => {
  const existing = [
    { type: 'parent', inverse: 'child', label: '父级', inverseLabel: '子级', color: '#1890ff' }
  ]

  it('合法输入返回 null', () => {
    expect(validateRelationshipTypeInput({ type: 'new', inverse: null, label: '新', inverseLabel: '新', color: '#fff', strength: 'medium' }, existing)).toBeNull()
  })

  it('type 重复返回错误', () => {
    expect(validateRelationshipTypeInput({ type: 'parent', inverse: null, label: 'x', inverseLabel: 'x', color: '#000', strength: 'medium' }, existing)).toMatch(/已存在/)
  })

  it('label 空返回错误', () => {
    expect(validateRelationshipTypeInput({ type: 'new', inverse: null, label: '', inverseLabel: 'x', color: '#000', strength: 'medium' }, existing)).toMatch(/label/i)
  })

  it('inverseLabel 空返回错误', () => {
    expect(validateRelationshipTypeInput({ type: 'new', inverse: null, label: 'x', inverseLabel: '', color: '#000', strength: 'medium' }, existing)).toMatch(/label/i)
  })

  it('color 格式错返回错误', () => {
    expect(validateRelationshipTypeInput({ type: 'new', inverse: null, label: 'x', inverseLabel: 'x', color: 'red', strength: 'medium' }, existing)).toMatch(/color/i)
  })

  it('type 非法字符返回错误', () => {
    expect(validateRelationshipTypeInput({ type: 'Has_Cap', inverse: null, label: 'x', inverseLabel: 'x', color: '#000', strength: 'medium' }, existing)).toMatch(/type/i)
  })

  it('strength 非法值返回错误', () => {
    expect(validateRelationshipTypeInput({ type: 'new', inverse: null, label: 'x', inverseLabel: 'x', color: '#000', strength: 'invalid' as any }, existing)).toMatch(/strength/i)
  })
})
