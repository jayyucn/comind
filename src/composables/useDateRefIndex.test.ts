import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { DateRefRecord, DateRefKind } from '../wasm/types'
import type { CoreClient } from '../wasm/client'

/**
 * 用 vi.hoisted 让 fakeClient 变量在工厂函数之前声明，
 * 这样 vi.mock 工厂中可以提前引用它（vi.mock 会被 hoist 到模块顶部）。
 */
const fakeClient = vi.hoisted(() => {
  return {
    queryDateRefs: vi.fn(),
    queryOverdueDateRefs: vi.fn(),
    getDateRefsByBlock: vi.fn(),
  }
})

vi.mock('../wasm/client', () => ({
  initCoreClient: vi.fn(async () => fakeClient as unknown as CoreClient),
}))

import { useDateRefIndex } from './useDateRefIndex'

function makeRef(partial: Partial<DateRefRecord>): DateRefRecord {
  return {
    id: partial.id ?? 'r1',
    block_id: partial.block_id ?? 'b1',
    kind: partial.kind ?? 'schedule',
    iso: partial.iso ?? '2026-07-20T09:00',
    date_day: partial.date_day ?? '2026-07-20',
    recurrence: partial.recurrence ?? 'none',
    lead_minutes: partial.lead_minutes ?? 0,
    event_ts: partial.event_ts ?? 0,
    created_at: partial.created_at ?? 0,
  }
}

describe('useDateRefIndex 读路径', () => {
  beforeEach(() => {
    fakeClient.queryDateRefs.mockReset()
    fakeClient.queryOverdueDateRefs.mockReset()
    fakeClient.getDateRefsByBlock.mockReset()
  })

  describe('queryByDateRange', () => {
    it('将 (kind, from, to) 原样转发到 client.queryDateRefs', async () => {
      fakeClient.queryDateRefs.mockResolvedValue([makeRef({ id: 'r1' })])
      const { queryByDateRange } = useDateRefIndex()
      const out = await queryByDateRange('schedule', '2026-07-01', '2026-07-31')
      expect(fakeClient.queryDateRefs).toHaveBeenCalledWith('schedule', '2026-07-01', '2026-07-31')
      expect(out).toHaveLength(1)
    })

    it('支持 "*" 全 kind 透传', async () => {
      fakeClient.queryDateRefs.mockResolvedValue([])
      const { queryByDateRange } = useDateRefIndex()
      await queryByDateRange('*', '2026-01-01', '2026-12-31')
      expect(fakeClient.queryDateRefs).toHaveBeenCalledWith('*', '2026-01-01', '2026-12-31')
    })
  })

  describe('queryOverdue', () => {
    it('将入参 ISO 截取到 date-day（YYYY-MM-DD）后调用 queryOverdueDateRefs', async () => {
      fakeClient.queryOverdueDateRefs.mockResolvedValue([makeRef({ id: 'o1' })])
      const { queryOverdue } = useDateRefIndex()
      const out = await queryOverdue('2026-07-20T14:30:00.000Z')
      expect(fakeClient.queryOverdueDateRefs).toHaveBeenCalledWith('2026-07-20')
      expect(out).toHaveLength(1)
    })

    it('未传参时使用当前日期（YYYY-MM-DD）', async () => {
      vi.useFakeTimers()
      try {
        // 当地时间，确保与 slice(0,10) 的 UTC 行为可能不同，断言只关心"返回的是 10 字符日期"
        vi.setSystemTime(new Date(2026, 6, 24, 14, 0, 0, 0))
        fakeClient.queryOverdueDateRefs.mockResolvedValue([])
        const { queryOverdue } = useDateRefIndex()
        await queryOverdue()
        const called = fakeClient.queryOverdueDateRefs.mock.calls[0][0] as string
        // toISOString 对本机时区敏感：保证长度与字符合法即可
        expect(called).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('queryByDate', () => {
    it('单日查询：from === to === date', async () => {
      fakeClient.queryDateRefs.mockResolvedValue([makeRef({ id: 'd1' })])
      const { queryByDate } = useDateRefIndex()
      const out = await queryByDate('2026-07-20')
      expect(fakeClient.queryDateRefs).toHaveBeenCalledWith('*', '2026-07-20', '2026-07-20')
      expect(out).toHaveLength(1)
    })

    it('显式 kind 时透传', async () => {
      fakeClient.queryDateRefs.mockResolvedValue([])
      const { queryByDate } = useDateRefIndex()
      await queryByDate('2026-07-20', 'deadline' as DateRefKind)
      expect(fakeClient.queryDateRefs).toHaveBeenCalledWith('deadline', '2026-07-20', '2026-07-20')
    })
  })

  describe('getBlockRefs', () => {
    it('调用 getDateRefsByBlock(blockId)', async () => {
      fakeClient.getDateRefsByBlock.mockResolvedValue([makeRef({ id: 'b1' })])
      const { getBlockRefs } = useDateRefIndex()
      const out = await getBlockRefs('block-1')
      expect(fakeClient.getDateRefsByBlock).toHaveBeenCalledWith('block-1')
      expect(out[0].block_id).toBe('b1')
    })
  })

  describe('索引写入 no-op（已迁 Rust）', () => {
    it('build 永远不调用 client 任何方法', async () => {
      const { build } = useDateRefIndex()
      await build([])
      expect(fakeClient.queryDateRefs).not.toHaveBeenCalled()
      expect(fakeClient.queryOverdueDateRefs).not.toHaveBeenCalled()
      expect(fakeClient.getDateRefsByBlock).not.toHaveBeenCalled()
    })

    it('updateBlock 永远不调用 client 任何方法', async () => {
      const { updateBlock } = useDateRefIndex()
      await updateBlock({ id: 'b1' })
      expect(fakeClient.queryDateRefs).not.toHaveBeenCalled()
    })

    it('removeBlock 永远不调用 client 任何方法', async () => {
      const { removeBlock } = useDateRefIndex()
      await removeBlock('b1')
      expect(fakeClient.queryDateRefs).not.toHaveBeenCalled()
    })
  })

  describe('返回结构', () => {
    it('暴露 build / updateBlock / removeBlock / 4 个查询方法', () => {
      const api = useDateRefIndex()
      expect(typeof api.build).toBe('function')
      expect(typeof api.updateBlock).toBe('function')
      expect(typeof api.removeBlock).toBe('function')
      expect(typeof api.queryByDateRange).toBe('function')
      expect(typeof api.queryOverdue).toBe('function')
      expect(typeof api.queryByDate).toBe('function')
      expect(typeof api.getBlockRefs).toBe('function')
    })
  })
})
