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
})
