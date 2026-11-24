import { beforeEach, describe, expect, test, vi } from 'vitest'

const mockClient = {
  getScreenViews: vi.fn(),
  createScreen: vi.fn(),
  createTab: vi.fn(),
  deleteScreen: vi.fn(),
  deleteScreenView: vi.fn(),
  markOrphanScreenViews: vi.fn(),
  cleanupOrphanScreenViews: vi.fn(),
}

vi.mock('../wasm/client', () => ({
  initCoreClient: vi.fn(async () => mockClient),
}))

import {
  QUERY_VIEW_ENTITY_PREFIX,
  QUERY_VIEW_ORPHAN_PREFIX,
  cleanupOrphanQueryViews,
  cloneQueryViewNamespace,
  markQueryViewOrphan,
  queryViewEntity,
} from './query-view-namespace'

function screen(overrides: Partial<{ id: string; parent_id: string; sort_order: number }> = {}) {
  return {
    id: 's1',
    entity: 'query-block:src',
    parent_id: '',
    name: '查询',
    query_json: '',
    view_type: 'table',
    group_by: '',
    is_default: 1,
    sort_order: 0,
    config: '{"columns":[]}',
    created_at: 0,
    updated_at: 0,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockClient.markOrphanScreenViews.mockResolvedValue(2)
  mockClient.cleanupOrphanScreenViews.mockResolvedValue({ deleted_screens: 1, deleted_tabs: 2, restored: 0 })
  mockClient.getScreenViews.mockResolvedValue([])
  mockClient.createScreen.mockImplementation(async (entity: string) => screen({ id: `${entity}-s1`, entity }))
  mockClient.createTab.mockImplementation(async (entity: string, parentId: string) =>
    screen({ id: `${entity}-t1`, entity, parent_id: parentId }),
  )
})

describe('query-view-namespace — 命名空间搬运', () => {
  test('queryViewEntity 用活前缀拼块 id（前缀是 Rust 原语的契约，改动会导致核销扫不到）', () => {
    expect(queryViewEntity('b1')).toBe('query-block:b1')
    expect(QUERY_VIEW_ENTITY_PREFIX).toBe('query-block:')
    expect(QUERY_VIEW_ORPHAN_PREFIX).toBe('query-orphan:')
  })

  test('markQueryViewOrphan 把两个前缀与 blockId 原样交给 Rust（前缀不在 Rust 侧硬编码）', async () => {
    await expect(markQueryViewOrphan('b1')).resolves.toBe(2)
    expect(mockClient.markOrphanScreenViews).toHaveBeenCalledWith('query-block:', 'query-orphan:', 'b1')
  })

  test('markQueryViewOrphan 吞掉失败并返回 0：删除路径不能被配置搬运拖挂', async () => {
    mockClient.markOrphanScreenViews.mockRejectedValue(new Error('db locked'))
    await expect(markQueryViewOrphan('b1')).resolves.toBe(0)
  })

  test('空 blockId 直接跳过，不触发 IPC', async () => {
    await expect(markQueryViewOrphan('')).resolves.toBe(0)
    expect(mockClient.markOrphanScreenViews).not.toHaveBeenCalled()
  })

  test('cleanupOrphanQueryViews 参数顺序是 (孤儿前缀, 活前缀) —— 反了会把活配置全删光', async () => {
    const report = await cleanupOrphanQueryViews()
    expect(mockClient.cleanupOrphanScreenViews).toHaveBeenCalledWith('query-orphan:', 'query-block:')
    expect(report).toEqual({ deleted_screens: 1, deleted_tabs: 2, restored: 0 })
  })

  test('cleanupOrphanQueryViews 失败时返回零报告，不向上抛（启动钩子不该炸）', async () => {
    mockClient.cleanupOrphanScreenViews.mockRejectedValue(new Error('boom'))
    await expect(cleanupOrphanQueryViews()).resolves.toEqual({
      deleted_screens: 0,
      deleted_tabs: 0,
      restored: 0,
    })
  })
})

describe('query-view-namespace — 复制块的配置克隆', () => {
  test('按 Screen → Tab 顺序重建，Tab 的 parent_id 指向**新** Screen', async () => {
    mockClient.getScreenViews.mockResolvedValue([
      screen({ id: 's1' }),
      screen({ id: 't1', parent_id: 's1', sort_order: 1, name: '全部' }),
    ])

    await cloneQueryViewNamespace('src', 'dst')

    expect(mockClient.getScreenViews).toHaveBeenCalledWith('query-block:src')
    expect(mockClient.createScreen).toHaveBeenCalledWith('query-block:dst', '查询', 'table', 0, '{"columns":[]}')
    expect(mockClient.createTab).toHaveBeenCalledWith(
      'query-block:dst',
      'query-block:dst-s1',
      '全部',
      'table',
      '',
      1,
      '{"columns":[]}',
    )
  })

  test('源块没有落库配置（从未打开过）→ 一次写都不发', async () => {
    await cloneQueryViewNamespace('src', 'dst')
    expect(mockClient.createScreen).not.toHaveBeenCalled()
    expect(mockClient.createTab).not.toHaveBeenCalled()
  })

  test('源刚被剪切（配置整组在孤儿前缀）→ 回退读孤儿命名空间再克隆', async () => {
    // 剪切 = 复制 + 删除，删除时 markQueryViewOrphan 已把源块的行改挂孤儿前缀。
    // 只读活前缀的话「剪切 → 立刻粘贴」会掉回默认三列（复制 → 粘贴不受影响）。
    mockClient.getScreenViews.mockImplementation(async (entity: string) =>
      entity === 'query-orphan:src'
        ? [screen({ id: 's1', entity }), screen({ id: 't1', entity, parent_id: 's1', name: '全部' })]
        : [],
    )

    await cloneQueryViewNamespace('src', 'dst')

    expect(mockClient.getScreenViews).toHaveBeenCalledWith('query-block:src')
    expect(mockClient.getScreenViews).toHaveBeenCalledWith('query-orphan:src')
    expect(mockClient.createScreen).toHaveBeenCalledWith('query-block:dst', '查询', 'table', 0, '{"columns":[]}')
    expect(mockClient.createTab).toHaveBeenCalledTimes(1)
  })

  test('活前缀优先：源块还在时不去摸孤儿前缀（撤销复活后两处都有行，不能抄错）', async () => {
    mockClient.getScreenViews.mockImplementation(async (entity: string) =>
      entity === 'query-block:src' ? [screen({ id: 's1' })] : [],
    )

    await cloneQueryViewNamespace('src', 'dst')

    expect(mockClient.getScreenViews).not.toHaveBeenCalledWith('query-orphan:src')
  })

  test('目标命名空间先清空：副本挂载时已 seed 一套默认 Screen+Tab，留着会叠成两组', async () => {
    mockClient.getScreenViews.mockImplementation(async (entity: string) => {
      if (entity === 'query-block:src') {
        return [screen({ id: 's1' }), screen({ id: 't1', parent_id: 's1', name: '全部' })]
      }
      if (entity === 'query-block:dst') {
        return [
          screen({ id: 'seed-s', entity, is_default: 1 }),
          screen({ id: 'seed-t', entity, parent_id: 'seed-s' }),
        ]
      }
      return []
    })

    await cloneQueryViewNamespace('src', 'dst')

    // 只删 Screen（Tabs 由 delete_screen 级联）；逐条删已随级联消失的 Tab 会抛错
    expect(mockClient.deleteScreen).toHaveBeenCalledWith('seed-s')
    expect(mockClient.deleteScreenView).not.toHaveBeenCalled()
    // 清空在先、重建在后
    expect(mockClient.deleteScreen.mock.invocationCallOrder[0]).toBeLessThan(
      mockClient.createScreen.mock.invocationCallOrder[0],
    )
  })

  test('源与目标相同（或空 id）→ 跳过，避免自己克隆自己', async () => {
    await cloneQueryViewNamespace('same', 'same')
    await cloneQueryViewNamespace('', 'dst')
    expect(mockClient.getScreenViews).not.toHaveBeenCalled()
  })

  test('克隆失败不抛出：副本退回默认配置，粘贴本身不能失败', async () => {
    mockClient.getScreenViews.mockRejectedValue(new Error('boom'))
    await expect(cloneQueryViewNamespace('src', 'dst')).resolves.toBeUndefined()
  })
})
