import { describe, test, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '../db'
import type { UserTemplate } from '../../types/template'

describe('ComindDB v9 templates table', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  test('应存在 templates 表且可写入一条记录', async () => {
    const template: UserTemplate = {
      id: 'tpl-1',
      name: 'Test',
      category: 'custom',
      sourcePageId: 'page-1',
      blocks: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await db.templates.put(template)
    const all = await db.templates.toArray()
    expect(all.length).toBe(1)
    expect(all[0].id).toBe('tpl-1')
  })

  test('应支持按 category 索引查询', async () => {
    await db.templates.put({
      id: 'a', name: 'A', category: 'work', sourcePageId: 'p', blocks: [], createdAt: 0, updatedAt: 0
    })
    await db.templates.put({
      id: 'b', name: 'B', category: 'journal', sourcePageId: 'p', blocks: [], createdAt: 0, updatedAt: 0
    })
    const workTemplates = await db.templates.where('category').equals('work').toArray()
    expect(workTemplates.length).toBe(1)
    expect(workTemplates[0].id).toBe('a')
  })
})
