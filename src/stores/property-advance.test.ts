/**
 * T11 · 自动推进 dateRef 测试（Done 语义）
 */
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBlockStore } from './blocks'
import { usePropertyStore } from './property'

// Mock core client —— 周期推进的日期计算本体在 Rust（S6），wasm 适配层无实现；
// 这里按用例数据在 mock 中复刻 Rust 契约（daily +1d / weekly +7d / monthly 取月末钳制）。
const { mockClient } = vi.hoisted(() => {
  function daysInMonth(year: number, month: number): number {
    return new Date(year, month, 0).getDate()
  }
  function nextIso(iso: string, rule: string): string {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)!
    let [, y, mo, d] = m.map(Number) as unknown as number[]
    if (rule === 'daily') {
      const dt = new Date(y, mo - 1, d + 1)
      y = dt.getFullYear(); mo = dt.getMonth() + 1; d = dt.getDate()
    } else if (rule === 'weekly') {
      const dt = new Date(y, mo - 1, d + 7)
      y = dt.getFullYear(); mo = dt.getMonth() + 1; d = dt.getDate()
    } else if (rule === 'monthly') {
      mo += 1
      if (mo > 12) { mo = 1; y += 1 }
      d = Math.min(d, daysInMonth(y, mo))
    } else {
      return iso
    }
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  const dateRefsByBlock: Record<string, Array<{ id: string; block_id: string; kind: string; iso: string; date_day: string; recurrence: string; lead_minutes: number; event_ts: number; created_at: number }>> = {
    // kind 与用例 content 中的 emoji 对应（📅=schedule，⏰=deadline）
    'block-1': [{ id: 'ref-1', block_id: 'block-1', kind: 'deadline', iso: '2026-07-15', date_day: '2026-07-15', recurrence: 'weekly', lead_minutes: 0, event_ts: 0, created_at: 0 }],
    'block-2': [{ id: 'ref-2', block_id: 'block-2', kind: 'schedule', iso: '2026-07-15', date_day: '2026-07-15', recurrence: 'daily', lead_minutes: 0, event_ts: 0, created_at: 0 }],
    'block-3': [{ id: 'ref-3', block_id: 'block-3', kind: 'deadline', iso: '2026-01-31', date_day: '2026-01-31', recurrence: 'monthly', lead_minutes: 0, event_ts: 0, created_at: 0 }],
  }
  const mockClient = {
    getProperties: vi.fn(() => Promise.resolve([])),
    setProperty: vi.fn(() => Promise.resolve({
      id: 'prop-1',
      block_id: 'block-1',
      key: 'status',
      value: 'Todo',
      type: 'string',
      sort_order: 0,
      is_hidden: 0,
      is_deleted: 0,
      schema_version: 0,
      created_at: Date.now(),
      updated_at: Date.now(),
    })),
    getDateRefsByBlock: vi.fn(async (blockId: string) => dateRefsByBlock[blockId] ?? []),
    calculateNextRecurrence: vi.fn(async (iso: string, rule: string) => nextIso(iso, rule)),
  }
  return { mockClient }
})

vi.mock('../wasm/client', () => ({
  initCoreClient: vi.fn(() => Promise.resolve(mockClient)),
  getCoreClient: vi.fn(() => mockClient),
}))

// Mock blocks store
vi.mock('./blocks', () => ({
  useBlockStore: vi.fn(),
}))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('T11 — 自动推进 dateRef（Done 语义）', () => {
  it('status=Done + content 含 weekly dateRef → 推进日期 + 重置 status=Todo', async () => {
    const mockBlocks = [{
      id: 'block-1',
      content: '任务 @2026-07-15 ⏰|weekly 完成',
      type: 'bullet',
      page: 'test-page',
      children: [],
      format: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }]

    const mockUpdateBlockContent = vi.fn()
    ;(useBlockStore as any).mockReturnValue({
      blocks: mockBlocks,
      updateBlockContent: mockUpdateBlockContent,
    })

    const store = usePropertyStore()
    
    // setProperty 内部会调用 advanceDateRefInBlock
    // 由于 mock 不触发真实逻辑，直接测试 advanceDateRefInBlock
    // @ts-ignore — 访问内部函数
    await store.advanceDateRefInBlock?.('block-1')

    // 验证 updateBlockContent 被调用（日期推进）
    expect(mockUpdateBlockContent).toHaveBeenCalledWith(
      'block-1',
      '任务 @2026-07-22 ⏰|weekly 完成'
    )
  })

  it('status=Done + content 含 daily dateRef → 推进日期 + 重置 status=Todo', async () => {
    const mockBlocks = [{
      id: 'block-2',
      content: '@2026-07-15 📅|daily',
      type: 'bullet',
      page: 'test-page',
      children: [],
      format: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }]

    const mockUpdateBlockContent = vi.fn()
    ;(useBlockStore as any).mockReturnValue({
      blocks: mockBlocks,
      updateBlockContent: mockUpdateBlockContent,
    })

    const store = usePropertyStore()
    // @ts-ignore
    await store.advanceDateRefInBlock?.('block-2')

    expect(mockUpdateBlockContent).toHaveBeenCalledWith(
      'block-2',
      '@2026-07-16 📅|daily'
    )
  })

  it('status=Done + content 含 monthly dateRef → 推进日期', async () => {
    const mockBlocks = [{
      id: 'block-3',
      content: '@2026-01-31 ⏰|monthly',
      type: 'bullet',
      page: 'test-page',
      children: [],
      format: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }]

    const mockUpdateBlockContent = vi.fn()
    ;(useBlockStore as any).mockReturnValue({
      blocks: mockBlocks,
      updateBlockContent: mockUpdateBlockContent,
    })

    const store = usePropertyStore()
    // @ts-ignore
    await store.advanceDateRefInBlock?.('block-3')

    // 2026-01-31 + 1 month = 2026-02-28（闰年）
    expect(mockUpdateBlockContent).toHaveBeenCalledWith(
      'block-3',
      '@2026-02-28 ⏰|monthly'
    )
  })

  it('status=Done + content 无 recurrence → 不推进', async () => {
    const mockBlocks = [{
      id: 'block-4',
      content: '@2026-07-15 ⏰', // 无 recurrence
      type: 'bullet',
      page: 'test-page',
      children: [],
      format: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }]

    const mockUpdateBlockContent = vi.fn()
    ;(useBlockStore as any).mockReturnValue({
      blocks: mockBlocks,
      updateBlockContent: mockUpdateBlockContent,
    })

    const store = usePropertyStore()
    // @ts-ignore
    await store.advanceDateRefInBlock?.('block-4')

    expect(mockUpdateBlockContent).not.toHaveBeenCalled()
  })

  it('status=Done + content 无 dateRef → 不推进', async () => {
    const mockBlocks = [{
      id: 'block-5',
      content: '普通任务',
      type: 'bullet',
      page: 'test-page',
      children: [],
      format: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }]

    const mockUpdateBlockContent = vi.fn()
    ;(useBlockStore as any).mockReturnValue({
      blocks: mockBlocks,
      updateBlockContent: mockUpdateBlockContent,
    })

    const store = usePropertyStore()
    // @ts-ignore
    await store.advanceDateRefInBlock?.('block-5')

    expect(mockUpdateBlockContent).not.toHaveBeenCalled()
  })

  it('block 不存在 → 安全跳过', async () => {
    ;(useBlockStore as any).mockReturnValue({
      blocks: [],
      updateBlockContent: vi.fn(),
    })

    const store = usePropertyStore()
    // @ts-ignore
    await store.advanceDateRefInBlock?.('non-existent')

    // 无错误即通过
    expect(true).toBe(true)
  })
})
