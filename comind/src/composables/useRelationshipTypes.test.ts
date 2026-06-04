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
    it('空表时种入 6 条种子记录', async () => {
      const { load, all } = useRelationshipTypes()
      await load()
      expect(all.value).toHaveLength(6)
      expect(all.value[0].type).toBe('parent')
      expect(all.value[0].id).toBe('rt_seed_parent')
      expect(all.value[0].order).toBe(0)
      expect(all.value[0].builtin).toBe(true)
    })

    it('非空时不覆盖已有记录', async () => {
      // 预置一条用户修改过的种子
      await db.relationshipTypes.put({
        id: 'rt_seed_parent',
        type: 'parent',
        inverse: 'child',
        label: '上级（已修改）',
        inverseLabel: '下级（已修改）',
        color: '#000000',
        order: 0,
        deleted: false,
        builtin: true
      })
      const { load, all } = useRelationshipTypes()
      await load()
      const parent = all.value.find(r => r.type === 'parent')
      expect(parent?.label).toBe('上级（已修改）')
      // 其余 5 条种子应该被补齐
      expect(all.value).toHaveLength(6)
    })

    it('非空时为缺失的种子补齐', async () => {
      // 预置前 2 条种子
      await db.relationshipTypes.put({ id: 'rt_seed_parent', type: 'parent', inverse: 'child', label: '父级', inverseLabel: '子级', color: '#1890ff', order: 0, deleted: false, builtin: true })
      await db.relationshipTypes.put({ id: 'rt_seed_depends-on', type: 'depends-on', inverse: 'required-by', label: '依赖', inverseLabel: '被依赖', color: '#faad14', order: 1, deleted: false, builtin: true })
      const { load, all } = useRelationshipTypes()
      await load()
      expect(all.value).toHaveLength(6)
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
      const custom = await create({ type: 'custom', inverse: null, label: '自定义', inverseLabel: '自定义', color: '#111111' })
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
      const created = await create({ type: 'blocker', inverse: 'blocked-by', label: '阻塞', inverseLabel: '被阻塞', color: '#ff0000' })
      expect(created.id).toMatch(/^rt_user_/)
      expect(created.order).toBe(6)  // 6 种子后
      expect(created.builtin).toBe(false)
      expect(all.value.find(r => r.id === created.id)).toBeTruthy()
    })

    it('type 重复时抛出错误', async () => {
      const { load, create } = useRelationshipTypes()
      await load()
      await expect(create({ type: 'parent', inverse: null, label: 'X', inverseLabel: 'X', color: '#000' })).rejects.toThrow(/已存在/)
    })

    it('type 与已软删记录冲突时允许创建', async () => {
      const { load, create, softDelete } = useRelationshipTypes()
      await load()
      const c1 = await create({ type: 'tmp', inverse: null, label: 'A', inverseLabel: 'A', color: '#000' })
      await softDelete(c1.id)
      const c2 = await create({ type: 'tmp', inverse: null, label: 'B', inverseLabel: 'B', color: '#000' })
      expect(c2.id).not.toBe(c1.id)
    })

    it('label 为空时抛出错误', async () => {
      const { load, create } = useRelationshipTypes()
      await load()
      await expect(create({ type: 'x', inverse: null, label: '', inverseLabel: 'x', color: '#000' })).rejects.toThrow(/label/i)
    })

    it('color 格式错时抛出错误', async () => {
      const { load, create } = useRelationshipTypes()
      await load()
      await expect(create({ type: 'x', inverse: null, label: 'x', inverseLabel: 'x', color: 'red' })).rejects.toThrow(/color/i)
    })

    it('type 不符合正则时抛出错误', async () => {
      const { load, create } = useRelationshipTypes()
      await load()
      await expect(create({ type: 'Has-Cap', inverse: null, label: 'x', inverseLabel: 'x', color: '#000' })).rejects.toThrow(/type/i)
    })
  })

  describe('update', () => {
    it('成功路径：局部更新', async () => {
      const { load, update, all } = useRelationshipTypes()
      await load()
      const parent = all.value.find(r => r.type === 'parent')!
      await update(parent.id, { label: '上级' })
      const updated = all.value.find(r => r.id === parent.id)!
      expect(updated.label).toBe('上级')
    })

    it('type 改为与其他记录冲突时抛出错误', async () => {
      const { load, update, all } = useRelationshipTypes()
      await load()
      const parent = all.value.find(r => r.type === 'parent')!
      await expect(update(parent.id, { type: 'related' })).rejects.toThrow(/已存在/)
    })
  })

  describe('softDelete + restore', () => {
    it('softDelete 设置 deleted=true', async () => {
      const { load, softDelete, all } = useRelationshipTypes()
      await load()
      const parent = all.value.find(r => r.type === 'parent')!
      await softDelete(parent.id)
      expect(all.value.find(r => r.id === parent.id)?.deleted).toBe(true)
    })

    it('restore 恢复 deleted=false', async () => {
      const { load, softDelete, restore, all } = useRelationshipTypes()
      await load()
      const parent = all.value.find(r => r.type === 'parent')!
      await softDelete(parent.id)
      await restore(parent.id)
      expect(all.value.find(r => r.id === parent.id)?.deleted).toBe(false)
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
    expect(validateRelationshipTypeInput({ type: 'new', inverse: null, label: '新', inverseLabel: '新', color: '#fff' }, existing)).toBeNull()
  })

  it('type 重复返回错误', () => {
    expect(validateRelationshipTypeInput({ type: 'parent', inverse: null, label: 'x', inverseLabel: 'x', color: '#000' }, existing)).toMatch(/已存在/)
  })

  it('label 空返回错误', () => {
    expect(validateRelationshipTypeInput({ type: 'new', inverse: null, label: '', inverseLabel: 'x', color: '#000' }, existing)).toMatch(/label/i)
  })

  it('inverseLabel 空返回错误', () => {
    expect(validateRelationshipTypeInput({ type: 'new', inverse: null, label: 'x', inverseLabel: '', color: '#000' }, existing)).toMatch(/label/i)
  })

  it('color 格式错返回错误', () => {
    expect(validateRelationshipTypeInput({ type: 'new', inverse: null, label: 'x', inverseLabel: 'x', color: 'red' }, existing)).toMatch(/color/i)
  })

  it('type 非法字符返回错误', () => {
    expect(validateRelationshipTypeInput({ type: 'Has_Cap', inverse: null, label: 'x', inverseLabel: 'x', color: '#000' }, existing)).toMatch(/type/i)
  })
})
