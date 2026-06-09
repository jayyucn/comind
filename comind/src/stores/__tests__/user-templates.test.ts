import { describe, test, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { setActivePinia, createPinia } from 'pinia'
import { useUserTemplatesStore } from '../user-templates'
import { db } from '../../storage/db'
import type { UserTemplate } from '../../types/template'

describe('user-templates store', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.delete()
    await db.open()
  })

  test('create 写入 db 并更新内存', async () => {
    const store = useUserTemplatesStore()
    const t = await store.create({
      name: 'Test',
      sourcePageId: 'p1',
      blocks: [{ type: 'bullet', content: 'hi' }],
    })
    expect(t.id).toBeTruthy()
    expect(t.category).toBe('custom')
    expect(store.templates.length).toBe(1)
    const fromDb = await db.templates.get(t.id)
    expect(fromDb).toBeDefined()
  })

  test('loadAll 从 db 加载', async () => {
    const seed: UserTemplate = {
      id: 't1', name: 'A', category: 'work', sourcePageId: 'p',
      blocks: [], createdAt: 0, updatedAt: 0,
    }
    await db.templates.put(seed)
    const store = useUserTemplatesStore()
    await store.loadAll()
    expect(store.templates.length).toBe(1)
    expect(store.templates[0].id).toBe('t1')
  })

  test('remove 从 db 与内存同时删除', async () => {
    const store = useUserTemplatesStore()
    const t = await store.create({ name: 'X', sourcePageId: 'p', blocks: [] })
    await store.remove(t.id)
    expect(store.templates.length).toBe(0)
    const fromDb = await db.templates.get(t.id)
    expect(fromDb).toBeUndefined()
  })

  test('rename 修改 name 并更新 updatedAt', async () => {
    const store = useUserTemplatesStore()
    const t = await store.create({ name: 'Old', sourcePageId: 'p', blocks: [] })
    await new Promise(r => setTimeout(r, 5))
    await store.rename(t.id, 'New')
    const after = store.templates.find(x => x.id === t.id)
    expect(after?.name).toBe('New')
    expect(after?.updatedAt).toBeGreaterThan(t.createdAt)
  })

  test('update 部分字段', async () => {
    const store = useUserTemplatesStore()
    const t = await store.create({
      name: 'A', sourcePageId: 'p',
      blocks: [{ type: 'bullet', content: 'x' }],
    })
    await store.update(t.id, { description: 'new desc', category: 'work' })
    const after = store.templates.find(x => x.id === t.id)
    expect(after?.description).toBe('new desc')
    expect(after?.category).toBe('work')
    expect(after?.blocks[0].content).toBe('x')  // 未改
  })

  test('rename 不存在的 ID 不报错', async () => {
    const store = useUserTemplatesStore()
    await store.rename('non-existent', 'New')
    expect(store.templates.length).toBe(0)
  })

  test('update 不存在的 ID 不报错', async () => {
    const store = useUserTemplatesStore()
    await store.update('non-existent', { name: 'New' })
    expect(store.templates.length).toBe(0)
  })

  test('remove 不存在的 ID 不报错', async () => {
    const store = useUserTemplatesStore()
    await store.remove('non-existent')
    expect(store.templates.length).toBe(0)
  })

  test('create 使用默认 category', async () => {
    const store = useUserTemplatesStore()
    const t = await store.create({
      name: 'Test',
      sourcePageId: 'p1',
      blocks: [],
    })
    expect(t.category).toBe('custom')
  })

  test('create 使用自定义 category', async () => {
    const store = useUserTemplatesStore()
    const t = await store.create({
      name: 'Test',
      category: 'work',
      sourcePageId: 'p1',
      blocks: [],
    })
    expect(t.category).toBe('work')
  })

  test('update 保留未修改的字段', async () => {
    const store = useUserTemplatesStore()
    const t = await store.create({
      name: 'Original',
      description: 'Original desc',
      category: 'personal',
      sourcePageId: 'p1',
      blocks: [{ type: 'bullet', content: 'test' }],
    })
    
    await store.update(t.id, { name: 'Updated' })
    
    const after = store.templates.find(x => x.id === t.id)
    expect(after?.name).toBe('Updated')
    expect(after?.description).toBe('Original desc')
    expect(after?.category).toBe('personal')
    expect(after?.blocks).toEqual([{ type: 'bullet', content: 'test' }])
  })

  test('create 生成唯一 ID', async () => {
    const store = useUserTemplatesStore()
    const t1 = await store.create({ name: 'T1', sourcePageId: 'p1', blocks: [] })
    const t2 = await store.create({ name: 'T2', sourcePageId: 'p1', blocks: [] })
    expect(t1.id).not.toBe(t2.id)
  })

  test('loadAll 覆盖内存中的 templates', async () => {
    const store = useUserTemplatesStore()
    
    // 创建一个模板
    await store.create({ name: 'InMemory', sourcePageId: 'p1', blocks: [] })
    expect(store.templates.length).toBe(1)
    
    // 直接在 db 中插入另一个模板（绕过 store）
    const anotherTemplate: UserTemplate = {
      id: 't-another',
      name: 'Another',
      category: 'work',
      sourcePageId: 'p2',
      blocks: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await db.templates.put(anotherTemplate)
    
    // loadAll 应该加载所有模板（包括 db 中的）
    await store.loadAll()
    expect(store.templates.length).toBe(2)
    expect(store.templates.map(t => t.id)).toContain('t-another')
  })
})
