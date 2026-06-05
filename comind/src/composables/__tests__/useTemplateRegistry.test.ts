import { describe, test, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { setActivePinia, createPinia } from 'pinia'

// 在引入 user-templates store 前 mock db
vi.mock('../../storage/db', () => ({
  db: {
    templates: {
      toArray: vi.fn().mockResolvedValue([]),
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    }
  }
}))

import { useTemplateRegistry } from '../useTemplateRegistry'
import { useUserTemplatesStore } from '../../stores/user-templates'

describe('useTemplateRegistry', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  test('仅内置模板时返回 10 个归一化模板', async () => {
    const userStore = useUserTemplatesStore()
    userStore.templates = []
    const registry = useTemplateRegistry()
    const list = await registry.loadAll()
    expect(list.length).toBe(10)
    expect(list.every(t => t.source === 'builtin')).toBe(true)
  })

  test('内置 + 用户模板合并：用户优先', async () => {
    const userStore = useUserTemplatesStore()
    userStore.templates = [{
      id: 'user-1',
      name: '我的会议',
      category: 'custom',
      sourcePageId: 'p1',
      blocks: [{ type: 'bullet', content: 'my variant' }],
      createdAt: 0,
      updatedAt: 0,
    }]
    const registry = useTemplateRegistry()
    const list = await registry.loadAll()
    expect(list.length).toBe(11)
    const userTpl = list.find(t => t.id === 'user:user-1')
    expect(userTpl).toBeDefined()
    expect(userTpl?.source).toBe('user')
    expect(userTpl?.blocks[0].content).toBe('my variant')
  })

  test('用户模板 ID 加 user: 前缀避免与内置冲突', async () => {
    const userStore = useUserTemplatesStore()
    userStore.templates = [{
      id: 'abc',
      name: 'X',
      category: 'custom',
      sourcePageId: 'p',
      blocks: [],
      createdAt: 0, updatedAt: 0,
    }]
    const registry = useTemplateRegistry()
    const list = await registry.loadAll()
    const ids = list.map(t => t.id)
    expect(ids).toContain('user:abc')
    expect(ids).not.toContain('abc')  // 不与可能的内置 ID 冲突
  })

  test('getById 优先返回用户模板（若 ID 相同）', async () => {
    const userStore = useUserTemplatesStore()
    userStore.templates = [{
      id: 'meeting-notes',  // 故意与内置同名
      name: '我的会议（覆盖内置）',
      category: 'custom',
      sourcePageId: 'p',
      blocks: [{ type: 'bullet', content: 'override' }],
      createdAt: 0, updatedAt: 0,
    }]
    const registry = useTemplateRegistry()
    await registry.loadAll()
    const t = registry.getById('user:meeting-notes')
    expect(t).toBeDefined()
    expect(t?.source).toBe('user')
    expect(t?.blocks[0].content).toBe('override')
  })

  test('getById 找不到时返回 undefined', async () => {
    const userStore = useUserTemplatesStore()
    userStore.templates = []
    const registry = useTemplateRegistry()
    await registry.loadAll()
    expect(registry.getById('non-existent')).toBeUndefined()
  })

  test('searchByText 按 name + alias + description 匹配（大小写不敏感）', async () => {
    const userStore = useUserTemplatesStore()
    userStore.templates = []
    const registry = useTemplateRegistry()
    await registry.loadAll()
    const results = registry.searchByText('MEETING')
    expect(results.length).toBeGreaterThan(0)
    expect(results.some(t => t.id === 'meeting-notes')).toBe(true)
  })
})
