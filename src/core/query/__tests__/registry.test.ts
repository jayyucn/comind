import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRegistry, type Registry, type FieldDescriptor } from '@/core/query'

interface Task {
  status: string
  priority: string
}

function statusField(): FieldDescriptor<Task> {
  return {
    key: 'status',
    label: '状态',
    type: 'select',
    get: (item) => item.status,
    options: [
      { id: 'open', label: '进行中' },
      { id: 'done', label: '已完成' },
    ],
  }
}

function priorityField(): FieldDescriptor<Task> {
  return {
    key: 'priority',
    label: '优先级',
    type: 'select',
    get: (item) => item.priority,
  }
}

describe('createRegistry', () => {
  let registry: Registry
  beforeEach(() => {
    registry = createRegistry()
  })

  describe('register / list', () => {
    it('register 后 list 能按 entityType 取到该字段', () => {
      registry.register('block', statusField())

      const fields = registry.list('block')
      expect(fields).toHaveLength(1)
      expect(fields[0].key).toBe('status')
      expect(fields[0].label).toBe('状态')
    })

    it('同 key 重复 register 覆盖旧描述符', () => {
      registry.register('block', statusField())
      registry.register('block', { ...statusField(), label: '状态(改)' })

      const fields = registry.list('block')
      expect(fields).toHaveLength(1)
      expect(fields[0].label).toBe('状态(改)')
    })

    it('list 返回的是快照拷贝，外部改动不影响注册表内部', () => {
      registry.register('block', statusField())
      const fields = registry.list('block')
      fields.push(priorityField())

      expect(registry.list('block')).toHaveLength(1)
    })

    it('list 返回空数组当 entityType 无注册字段', () => {
      expect(registry.list('block')).toEqual([])
    })
  })

  describe('namespace isolation', () => {
    it('不同 entityType 的字段互不污染', () => {
      registry.register('block', statusField())
      registry.register('page', priorityField())

      expect(registry.list('block')).toHaveLength(1)
      expect(registry.list('page')).toHaveLength(1)
      expect(registry.list('block')[0].key).toBe('status')
      expect(registry.list('page')[0].key).toBe('priority')
    })

    it('同 key 跨 entityType 不冲突', () => {
      registry.register('block', statusField())
      registry.register('page', { ...statusField(), label: '页面状态' })

      expect(registry.list('block')[0].label).toBe('状态')
      expect(registry.list('page')[0].label).toBe('页面状态')
    })
  })

  describe('get / unregister', () => {
    it('get 按 entityType+key 精确取描述符', () => {
      registry.register('block', statusField())
      registry.register('block', priorityField())

      expect(registry.get('block', 'status')?.label).toBe('状态')
      expect(registry.get('block', 'missing')).toBeUndefined()
      expect(registry.get('page', 'status')).toBeUndefined()
    })

    it('unregister 仅移除指定 entityType 下的该 key', () => {
      registry.register('block', statusField())
      registry.register('block', priorityField())
      registry.register('page', statusField())

      registry.unregister('block', 'status')

      expect(registry.get('block', 'status')).toBeUndefined()
      expect(registry.get('block', 'priority')?.key).toBe('priority')
      expect(registry.get('page', 'status')?.key).toBe('status')
    })

    it('unregister 不存在的 key 安全无副作用', () => {
      expect(() => registry.unregister('block', 'ghost')).not.toThrow()
      expect(registry.list('block')).toEqual([])
    })
  })

  describe('subscription', () => {
    it('register / unregister 触发订阅回调', () => {
      const listener = vi.fn()
      registry.subscribe(listener)

      registry.register('block', statusField())
      registry.unregister('block', 'status')

      expect(listener).toHaveBeenCalledTimes(2)
    })

    it('subscribe 返回的函数可取消订阅', () => {
      const listener = vi.fn()
      const unsubscribe = registry.subscribe(listener)

      unsubscribe()
      registry.register('block', statusField())

      expect(listener).not.toHaveBeenCalled()
    })

    it('多订阅者各自收到通知', () => {
      const a = vi.fn()
      const b = vi.fn()
      registry.subscribe(a)
      registry.subscribe(b)

      registry.register('block', statusField())

      expect(a).toHaveBeenCalledTimes(1)
      expect(b).toHaveBeenCalledTimes(1)
    })

    it('订阅回调在运行时增删动态字段后仍能感知', () => {
      let calls = 0
      let lastKeys: string[] = []
      registry.subscribe(() => {
        calls += 1
        lastKeys = registry.list('block').map((f) => f.key)
      })

      registry.register('block', statusField())
      registry.register('block', priorityField())
      registry.unregister('block', 'status')

      expect(calls).toBe(3)
      expect(lastKeys).toEqual(['priority'])
    })
  })

  describe('purity', () => {
    it('可在无 Vue / Pinia / WASM 的环境下独立实例化', () => {
      const reg = createRegistry()
      expect(typeof reg.register).toBe('function')
      expect(typeof reg.list).toBe('function')
      expect(typeof reg.unregister).toBe('function')
      expect(typeof reg.get).toBe('function')
      expect(typeof reg.subscribe).toBe('function')
    })
  })
})
