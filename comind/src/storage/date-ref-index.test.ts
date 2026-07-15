/**
 * T12 · DateRefIndex 测试
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { DateRefIndex, type IndexEntry } from '../storage/date-ref-index'

function makeBlock(id: string, content: string) {
  return { id, content }
}

describe('DateRefIndex', () => {
  let index: DateRefIndex

  beforeEach(() => {
    index = new DateRefIndex()
  })

  // ── build ───────────────────────────────────────────────────────

  it('从空列表构建索引为空', () => {
    index.build([])
    expect(index.size).toBe(0)
  })

  it('从 content 含 dateRef 的 blocks 构建索引', () => {
    index.build([
      makeBlock('b1', '任务 {{schedule:2026-07-15}}'),
      makeBlock('b2', '{{deadline:2026-07-20}}'),
      makeBlock('b3', '无 dateRef'),
    ])
    expect(index.size).toBe(2)
    expect(index.getAllIndexedBlocks()).toEqual(['b1', 'b2'])
  })

  it('一个 block 含多个 dateRef', () => {
    index.build([
      makeBlock('b1', '{{schedule:2026-07-15}} 和 {{deadline:2026-08-01}}'),
    ])
    expect(index.size).toBe(1)
    const refs = index.getBlockRefs('b1')
    expect(refs).toHaveLength(2)
    expect(refs![0].kind).toBe('schedule')
    expect(refs![1].kind).toBe('deadline')
  })

  // ── update ──────────────────────────────────────────────────────

  it('更新 block content 后索引同步', () => {
    index.build([
      makeBlock('b1', '{{schedule:2026-07-15}}'),
    ])
    expect(index.size).toBe(1)

    // 移除 dateRef
    index.update('b1', '普通内容')
    expect(index.size).toBe(0)

    // 添加新的 dateRef
    index.update('b1', '{{deadline:2026-08-01|weekly}}')
    expect(index.size).toBe(1)
    const refs = index.getBlockRefs('b1')
    expect(refs![0].kind).toBe('deadline')
    expect(refs![0].iso).toBe('2026-08-01')
    expect(refs![0].recurrence).toBe('weekly')
  })

  it('更新为 null 时移除索引', () => {
    index.build([
      makeBlock('b1', '{{schedule:2026-07-15}}'),
    ])
    index.update('b1', null)
    expect(index.size).toBe(0)
  })

  it('更新不存在的 block 安全跳过', () => {
    index.update('non-existent', '{{schedule:2026-07-15}}')
    expect(index.size).toBe(1)
  })

  it('移除 block 后查询不出', () => {
    index.build([
      makeBlock('b1', '{{schedule:2026-07-15}}'),
    ])
    index.remove('b1')
    expect(index.size).toBe(0)
    expect(index.queryByDateRange('*', '2026-07-15', '2026-07-15')).toHaveLength(0)
  })

  // ── queryByDateRange ────────────────────────────────────────────

  it('按日期范围查询 — 单日', () => {
    index.build([
      makeBlock('b1', '{{schedule:2026-07-15}}'),
      makeBlock('b2', '{{schedule:2026-07-20}}'),
    ])
    const result = index.queryByDateRange('schedule', '2026-07-15', '2026-07-15')
    expect(result).toHaveLength(1)
    expect(result[0].blockId).toBe('b1')
  })

  it('按日期范围查询 — 跨日', () => {
    index.build([
      makeBlock('b1', '{{schedule:2026-07-10}}'),
      makeBlock('b2', '{{schedule:2026-07-15}}'),
      makeBlock('b3', '{{schedule:2026-07-20}}'),
      makeBlock('b4', '{{deadline:2026-07-12}}'),
    ])
    const result = index.queryByDateRange('schedule', '2026-07-12', '2026-07-18')
    expect(result).toHaveLength(1)
    expect(result[0].blockId).toBe('b2')
  })

  it('按日期范围查询所有 kind', () => {
    index.build([
      makeBlock('b1', '{{schedule:2026-07-15}}'),
      makeBlock('b2', '{{deadline:2026-07-15}}'),
    ])
    const result = index.queryByDateRange('*', '2026-07-15', '2026-07-15')
    expect(result).toHaveLength(2)
  })

  it('无匹配时返回空数组', () => {
    index.build([
      makeBlock('b1', '{{schedule:2026-07-15}}'),
    ])
    const result = index.queryByDateRange('schedule', '2026-08-01', '2026-08-31')
    expect(result).toEqual([])
  })

  it('按 iso 排序返回', () => {
    index.build([
      makeBlock('b3', '{{schedule:2026-07-20}}'),
      makeBlock('b1', '{{schedule:2026-07-10}}'),
      makeBlock('b2', '{{schedule:2026-07-15}}'),
    ])
    const result = index.queryByDateRange('schedule', '2026-07-01', '2026-07-31')
    expect(result.map(r => r.blockId)).toEqual(['b1', 'b2', 'b3'])
  })

  it('处理包含时间的 iso', () => {
    index.build([
      makeBlock('b1', '{{schedule:2026-07-15T14:00}}'),
      makeBlock('b2', '{{schedule:2026-07-15T09:00}}'),
    ])
    const result = index.queryByDateRange('schedule', '2026-07-15', '2026-07-15')
    expect(result).toHaveLength(2)
  })

  // ── queryOverdue ────────────────────────────────────────────────

  it('返回截止日期早于今日的 deadline', () => {
    index.build([
      makeBlock('b1', '{{deadline:2026-07-10}}'), // 逾期
      makeBlock('b2', '{{deadline:2026-07-20}}'), // 正常
      makeBlock('b3', '{{deadline:2026-07-15}}'), // 今日，不逾期
    ])
    const overdue = index.queryOverdue('2026-07-15')
    expect(overdue).toHaveLength(1)
    expect(overdue[0].blockId).toBe('b1')
  })

  it('无逾期 deadline 时返回空', () => {
    index.build([
      makeBlock('b1', '{{deadline:2026-07-20}}'),
    ])
    const overdue = index.queryOverdue('2026-07-15')
    expect(overdue).toEqual([])
  })

  it('只返回 deadline，不包含 schedule', () => {
    index.build([
      makeBlock('b1', '{{deadline:2026-07-10}}'),
      makeBlock('b2', '{{schedule:2026-07-05}}'), // schedule 不会算逾期
    ])
    const overdue = index.queryOverdue('2026-07-15')
    expect(overdue).toHaveLength(1)
    expect(overdue[0].blockId).toBe('b1')
  })

  // ── queryByDate ─────────────────────────────────────────────────

  it('查某一天的所有 dateRef', () => {
    index.build([
      makeBlock('b1', '{{schedule:2026-07-15}}'),
      makeBlock('b2', '{{deadline:2026-07-15}}'),
      makeBlock('b3', '{{schedule:2026-07-16}}'),
    ])
    const result = index.queryByDate('2026-07-15')
    expect(result).toHaveLength(2)
  })

  it('按 kind 限定单日查询', () => {
    index.build([
      makeBlock('b1', '{{schedule:2026-07-15}}'),
      makeBlock('b2', '{{deadline:2026-07-15}}'),
    ])
    const result = index.queryByDate('2026-07-15', 'deadline')
    expect(result).toHaveLength(1)
    expect(result[0].blockId).toBe('b2')
  })

  // ── getBlockRefs ────────────────────────────────────────────────

  it('获取单个 block 的所有 dateRef', () => {
    index.build([
      makeBlock('b1', '{{schedule:2026-07-15}} 和 {{deadline:2026-08-01|weekly}}'),
    ])
    const refs = index.getBlockRefs('b1')
    expect(refs).toHaveLength(2)
    expect(refs![0].kind).toBe('schedule')
    expect(refs![1].recurrence).toBe('weekly')
  })

  it('不存在的 block 返回 undefined', () => {
    expect(index.getBlockRefs('non-existent')).toBeUndefined()
  })

  // ── 增量更新后查询签名 ──────────────────────────────────────────

  it('增量 update 后 byKind 索引一致', () => {
    index.build([
      makeBlock('b1', '{{deadline:2026-07-10}}'),
    ])

    // 变更内容，移除 deadline 并添加 schedule
    index.update('b1', '{{schedule:2026-07-20}}')

    // 之前的 deadline 不应再出现在逾期中
    expect(index.queryOverdue('2026-07-15')).toHaveLength(0)

    // 新的 schedule 应出现在范围查询中
    const result = index.queryByDateRange('schedule', '2026-07-20', '2026-07-20')
    expect(result).toHaveLength(1)
    expect(result[0].blockId).toBe('b1')
  })

  it('多个 block 同一天 — 添加和删除', () => {
    index.build([
      makeBlock('b1', '{{schedule:2026-07-15}}'),
      makeBlock('b2', '{{schedule:2026-07-15}}'),
      makeBlock('b3', '{{schedule:2026-07-15}}'),
    ])

    expect(index.queryByDate('2026-07-15')).toHaveLength(3)

    index.update('b1', '无 dateRef')
    expect(index.queryByDate('2026-07-15')).toHaveLength(2)

    index.remove('b2')
    expect(index.queryByDate('2026-07-15')).toHaveLength(1)
  })
})
