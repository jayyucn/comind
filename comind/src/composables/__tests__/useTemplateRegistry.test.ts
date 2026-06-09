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

describe('useTemplateRegistry - singleton state', () => {
  test('两次调用共享 all ref（不创建新空 ref）', async () => {
    const r1 = useTemplateRegistry()
    await r1.loadAll()
    expect(r1.all.value.length).toBeGreaterThan(0)

    const r2 = useTemplateRegistry()
    expect(r2.all.value).toBe(r1.all.value)  // 同一个数组引用
    expect(r2.all.value.length).toBeGreaterThan(0)
    expect(r2.isLoaded.value).toBe(true)
  })
})

// ─── 边界情况和错误处理测试 ─────────────────────────────────

describe('useTemplateRegistry - edge cases', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  test('searchByText 空查询返回所有模板', async () => {
    const userStore = useUserTemplatesStore()
    userStore.templates = []
    const registry = useTemplateRegistry()
    await registry.loadAll()
    const results = registry.searchByText('')
    expect(results.length).toBe(10)
  })

  test('searchByText 按 description 匹配', async () => {
    const userStore = useUserTemplatesStore()
    userStore.templates = []
    const registry = useTemplateRegistry()
    await registry.loadAll()
    const results = registry.searchByText('引导追问')
    expect(results.length).toBeGreaterThan(0)
    expect(results.some(t => t.id === 'second-order-thinking')).toBe(true)
  })

  test('searchByText 按 alias 匹配', async () => {
    const userStore = useUserTemplatesStore()
    userStore.templates = []
    const registry = useTemplateRegistry()
    await registry.loadAll()
    const results = registry.searchByText('5why')
    expect(results.length).toBeGreaterThan(0)
    expect(results.some(t => t.id === 'five-whys')).toBe(true)
  })

  test('searchByText 无匹配返回空数组', async () => {
    const userStore = useUserTemplatesStore()
    userStore.templates = []
    const registry = useTemplateRegistry()
    await registry.loadAll()
    const results = registry.searchByText('xyz-nonexistent')
    expect(results).toEqual([])
  })

  test('loadAll 处理 userStore.templates 为 null 的情况', async () => {
    const userStore = useUserTemplatesStore()
    ;(userStore as any).templates = null
    const registry = useTemplateRegistry()
    const list = await registry.loadAll()
    expect(list.length).toBe(10)  // 仅内置模板
  })

  test('loadAll 处理 userStore.loadAll 抛出错误的情况', async () => {
    const userStore = useUserTemplatesStore()
    userStore.templates = []
    // Mock loadAll to throw
    const originalLoadAll = userStore.loadAll
    userStore.loadAll = vi.fn().mockRejectedValue(new Error('DB error'))
    
    const registry = useTemplateRegistry()
    // 不应抛出错误
    const list = await registry.loadAll()
    expect(list.length).toBe(10)  // 回退到内置模板
    
    userStore.loadAll = originalLoadAll
  })

  test('用户模板无 aliases 时正确归一化', async () => {
    const userStore = useUserTemplatesStore()
    userStore.templates = [{
      id: 'no-alias',
      name: 'No Alias Template',
      category: 'custom',
      sourcePageId: 'p',
      blocks: [],
      createdAt: 0,
      updatedAt: 0,
    }]
    const registry = useTemplateRegistry()
    const list = await registry.loadAll()
    const userTpl = list.find(t => t.id === 'user:no-alias')
    expect(userTpl).toBeDefined()
    expect(userTpl?.aliases).toBeUndefined()
  })

  test('用户模板无 description 时使用空字符串', async () => {
    const userStore = useUserTemplatesStore()
    userStore.templates = [{
      id: 'no-desc',
      name: 'No Desc Template',
      category: 'custom',
      sourcePageId: 'p',
      blocks: [],
      createdAt: 0,
      updatedAt: 0,
    }]
    const registry = useTemplateRegistry()
    const list = await registry.loadAll()
    const userTpl = list.find(t => t.id === 'user:no-desc')
    expect(userTpl).toBeDefined()
    expect(userTpl?.description).toBe('')
  })

  test('用户模板使用默认 icon', async () => {
    const userStore = useUserTemplatesStore()
    userStore.templates = [{
      id: 'custom-icon',
      name: 'Custom',
      category: 'custom',
      sourcePageId: 'p',
      blocks: [],
      createdAt: 0,
      updatedAt: 0,
    }]
    const registry = useTemplateRegistry()
    const list = await registry.loadAll()
    const userTpl = list.find(t => t.id === 'user:custom-icon')
    expect(userTpl).toBeDefined()
    expect(userTpl?.icon).toBe('📄')
  })

  test('多个用户模板按创建顺序排列（用户模板在前）', async () => {
    const userStore = useUserTemplatesStore()
    userStore.templates = [
      { id: 'u1', name: 'User 1', category: 'custom', sourcePageId: 'p', blocks: [], createdAt: 100, updatedAt: 100 },
      { id: 'u2', name: 'User 2', category: 'custom', sourcePageId: 'p', blocks: [], createdAt: 200, updatedAt: 200 },
    ]
    const registry = useTemplateRegistry()
    const list = await registry.loadAll()
    // 用户模板在前
    expect(list[0].id).toBe('user:u1')
    expect(list[1].id).toBe('user:u2')
    // 内置模板在后
    expect(list[2].source).toBe('builtin')
  })

  test('getById 区分大小写', async () => {
    const userStore = useUserTemplatesStore()
    userStore.templates = []
    const registry = useTemplateRegistry()
    await registry.loadAll()
    expect(registry.getById('Meeting-Notes')).toBeUndefined()
    expect(registry.getById('meeting-notes')).toBeDefined()
  })

  test('searchByText 部分匹配', async () => {
    const userStore = useUserTemplatesStore()
    userStore.templates = []
    const registry = useTemplateRegistry()
    await registry.loadAll()
    const results = registry.searchByText('思维')
    expect(results.length).toBeGreaterThan(0)
    // 应匹配 二阶思维
    const ids = results.map(t => t.id)
    expect(ids).toContain('second-order-thinking')
  })
})
