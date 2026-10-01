/**
 * T15 · 存量数据迁移测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { migrateDateProperties, formatMigrationReport } from '../migrate'
import type { CoreClient } from '../wasm/client'

function createMockClient(overrides?: Partial<CoreClient>): CoreClient {
  return {
    getAllPages: vi.fn(),
    getBlocksByPage: vi.fn(),
    getProperties: vi.fn(),
    saveBlockTree: vi.fn(),
    deleteProperty: vi.fn(),
    // 以下方法测试中未使用，但类型要求
    getBlock: vi.fn(),
    getPage: vi.fn(),
    savePage: vi.fn(),
    deletePageCascade: vi.fn(),
    getBacklinks: vi.fn(),
    getOutlinks: vi.fn(),
    setProperty: vi.fn(),
    getRelationshipTypes: vi.fn(),
    getTemplates: vi.fn(),
    search: vi.fn(),
    executeBatch: vi.fn(),
    ...overrides,
  }
}

/** FieldValue 行（新形状：值为 JSON 文本存于 value_json，类型在 value_type）。 */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fv-1',
    block_id: 'block-1',
    field_definition_id: 'fd-1',
    value_json: '',
    value_type: 'string',
    seq: 0,
    created_at: 0,
    updated_at: 0,
    version: 0,
    deleted_at: null as number | null,
    key: '',
    ...overrides,
  }
}

describe('migrateDateProperties', () => {
  let client: CoreClient

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('无页面时返回空结果', async () => {
    client = createMockClient({
      getAllPages: vi.fn().mockResolvedValue([]),
    })
    const result = await migrateDateProperties(client)
    expect(result.totalScanned).toBe(0)
    expect(result.migratedBlocks).toBe(0)
    expect(result.errors).toHaveLength(0)
  })

  it('迁移 deadline 属性为 inline dateRef', async () => {
    client = createMockClient({
      getAllPages: vi.fn().mockResolvedValue([
        { id: 'page-1' },
      ]),
      getBlocksByPage: vi.fn().mockResolvedValue([
        { id: 'block-1', page_id: 'page-1', parent_id: null, pos: 1000, content: '买牛奶', format: '{}', type: 'bullet' },
      ]),
      getProperties: vi.fn().mockResolvedValue([
        row({ id: 'prop-1', key: 'deadline', value_json: '"2026-07-20"', value_type: 'date' }),
      ]),
    })

    const result = await migrateDateProperties(client)
    expect(result.totalScanned).toBe(1)
    expect(result.migratedBlocks).toBe(1)
    expect(result.deletedProperties).toBe(1)

    // 验证 content 被正确更新
    expect(client.saveBlockTree).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'block-1',
        content: '@2026-07-20 ⏰ 买牛奶',
      }),
    ])

    // 验证旧属性被删除
    expect(client.deleteProperty).toHaveBeenCalledWith('block-1', 'deadline')
  })

  it('迁移 scheduled + recurrence 属性', async () => {
    client = createMockClient({
      getAllPages: vi.fn().mockResolvedValue([
        { id: 'page-1' },
      ]),
      getBlocksByPage: vi.fn().mockResolvedValue([
        { id: 'block-1', page_id: 'page-1', parent_id: null, pos: 1000, content: '周报', format: '{}', type: 'bullet' },
      ]),
      getProperties: vi.fn().mockResolvedValue([
        row({ id: 'prop-1', key: 'scheduled', value_json: '"2026-07-15"', value_type: 'date' }),
        row({ id: 'prop-2', key: 'recurrence', value_json: 'weekly', value_type: 'string' }),
      ]),
    })

    const result = await migrateDateProperties(client)
    expect(result.migratedBlocks).toBe(1)
    expect(result.deletedProperties).toBe(2)

    expect(client.saveBlockTree).toHaveBeenCalledWith([
      expect.objectContaining({
        content: '@2026-07-15 📅|weekly 周报',
      }),
    ])

    expect(client.deleteProperty).toHaveBeenCalledWith('block-1', 'scheduled')
    expect(client.deleteProperty).toHaveBeenCalledWith('block-1', 'recurrence')
  })

  it('跳过已含 dateRef 的 block（幂等）', async () => {
    client = createMockClient({
      getAllPages: vi.fn().mockResolvedValue([
        { id: 'page-1' },
      ]),
      getBlocksByPage: vi.fn().mockResolvedValue([
        { id: 'block-1', page_id: 'page-1', parent_id: null, pos: 1000, content: '@2026-07-20 ⏰ 买牛奶', format: '{}', type: 'bullet' },
      ]),
      getProperties: vi.fn().mockResolvedValue([
        row({ id: 'prop-1', key: 'deadline', value_json: '"2026-07-20"', value_type: 'date' }),
      ]),
    })

    const result = await migrateDateProperties(client)
    expect(result.migratedBlocks).toBe(0) // 跳过
    expect(result.deletedProperties).toBe(0) // 未删
    expect(client.saveBlockTree).not.toHaveBeenCalled()
  })

  it('空内容的 block 用 dateRef 作为全文', async () => {
    client = createMockClient({
      getAllPages: vi.fn().mockResolvedValue([
        { id: 'page-1' },
      ]),
      getBlocksByPage: vi.fn().mockResolvedValue([
        { id: 'block-1', page_id: 'page-1', parent_id: null, pos: 1000, content: '', format: '{}', type: 'bullet' },
      ]),
      getProperties: vi.fn().mockResolvedValue([
        row({ id: 'prop-1', key: 'deadline', value_json: '"2026-07-20"', value_type: 'date' }),
      ]),
    })

    const result = await migrateDateProperties(client)
    expect(result.migratedBlocks).toBe(1)
    expect(client.saveBlockTree).toHaveBeenCalledWith([
      expect.objectContaining({ content: '@2026-07-20 ⏰' }),
    ])
  })

  it('无 deadline/scheduled 属性的 block 跳过', async () => {
    client = createMockClient({
      getAllPages: vi.fn().mockResolvedValue([
        { id: 'page-1' },
      ]),
      getBlocksByPage: vi.fn().mockResolvedValue([
        { id: 'block-1', page_id: 'page-1', parent_id: null, pos: 1000, content: '普通内容', format: '{}', type: 'bullet' },
      ]),
      getProperties: vi.fn().mockResolvedValue([
        row({ id: 'prop-1', key: 'status', value_json: 'Todo', value_type: 'string' }),
      ]),
    })

    const result = await migrateDateProperties(client)
    expect(result.migratedBlocks).toBe(0)
    expect(result.deletedProperties).toBe(0)
  })

  it('多页面批量迁移', async () => {
    client = createMockClient({
      getAllPages: vi.fn().mockResolvedValue([
        { id: 'page-1' },
        { id: 'page-2' },
      ]),
      getBlocksByPage: vi.fn()
        .mockResolvedValueOnce([
          { id: 'b1', page_id: 'page-1', parent_id: null, pos: 1000, content: '任务A', format: '{}', type: 'bullet' },
        ])
        .mockResolvedValueOnce([
          { id: 'b2', page_id: 'page-2', parent_id: null, pos: 1000, content: '任务B', format: '{}', type: 'bullet' },
        ]),
      getProperties: vi.fn()
        .mockResolvedValueOnce([
          row({ id: 'p1', block_id: 'b1', key: 'deadline', value_json: '"2026-07-20"', value_type: 'date' }),
        ])
        .mockResolvedValueOnce([]),
    })

    const result = await migrateDateProperties(client)
    expect(result.totalScanned).toBe(2)
    expect(result.migratedBlocks).toBe(1) // 只有第一个 block 有 deadline
    expect(result.deletedProperties).toBe(1)
  })

  it('异常不会中断迁移（跳过继续）', async () => {
    client = createMockClient({
      getAllPages: vi.fn().mockResolvedValue([
        { id: 'page-1' },
      ]),
      getBlocksByPage: vi.fn().mockResolvedValue([
        { id: 'b1', page_id: 'page-1', parent_id: null, pos: 1000, content: '失败block', format: '{}', type: 'bullet' },
        { id: 'b2', page_id: 'page-1', parent_id: null, pos: 1000, content: '成功block', format: '{}', type: 'bullet' },
      ]),
      getProperties: vi.fn()
        .mockResolvedValueOnce([
          row({ id: 'p1', block_id: 'b1', key: 'deadline', value_json: '"2026-07-20"', value_type: 'date' }),
        ])
        .mockResolvedValueOnce([
          row({ id: 'p2', block_id: 'b2', key: 'deadline', value_json: '"2026-07-25"', value_type: 'date' }),
        ]),
      saveBlockTree: vi.fn()
        .mockRejectedValueOnce(new Error('保存失败'))
        .mockResolvedValueOnce([]),
    })

    const result = await migrateDateProperties(client)
    expect(result.totalScanned).toBe(2)
    expect(result.migratedBlocks).toBe(1) // 第二个成功
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].blockId).toBe('b1')
  })

  it('格式报告的边界情况', () => {
    const report = formatMigrationReport({
      totalScanned: 100,
      migratedBlocks: 5,
      deletedProperties: 8,
      errors: [],
    })
    expect(report).toContain('100')
    expect(report).toContain('5')
    expect(report).not.toContain('❌')

    const reportWithErrors = formatMigrationReport({
      totalScanned: 10,
      migratedBlocks: 0,
      deletedProperties: 0,
      errors: [{ blockId: 'b1', error: 'Connection failed' }],
    })
    expect(reportWithErrors).toContain('❌')
    expect(reportWithErrors).toContain('b1')
    expect(reportWithErrors).toContain('Connection failed')
  })

  it('已删除标记的属性 (is_deleted=1) 不处理', async () => {
    client = createMockClient({
      getAllPages: vi.fn().mockResolvedValue([
        { id: 'page-1' },
      ]),
      getBlocksByPage: vi.fn().mockResolvedValue([
        { id: 'block-1', page_id: 'page-1', parent_id: null, pos: 1000, content: '内容', format: '{}', type: 'bullet' },
      ]),
      getProperties: vi.fn().mockResolvedValue([
        row({ id: 'prop-1', key: 'deadline', value_json: '"2026-07-20"', value_type: 'date', deleted_at: 123 }),
      ]),
    })

    const result = await migrateDateProperties(client)
    expect(result.migratedBlocks).toBe(0)
  })
})
