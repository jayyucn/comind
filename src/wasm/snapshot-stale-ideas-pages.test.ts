/**
 * Ideas 页物化服务 WASM 冒烟（issue #69 — ADR-0042 T4，Seam ③）
 *
 * 与 #66/#68 的 Rust 单测（Seam ①）互补：这里驱动真实 comind-wasm（sqljs 内存库）
 * 走完整 IPC 命令链 snapshot_stale_ideas_pages，验证物化在 wasm 端可运行且幂等。
 * 不测内部序列化格式（那是 Seam ① 的职责）。
 */
import { describe, it, expect } from 'vitest'
import { getTestCore } from '../../tests/core-client'
import type { PageUpdate } from './types'

/** 本地时区 yyyy-MM-dd（Rust 端物化 today 取 chrono wasmbind = 浏览器本地时区，勿用 UTC） */
function localDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function yesterdayStr(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return localDateStr(d)
}

describe('snapshot_stale_ideas_pages — WASM 冒烟（Seam ③）', () => {
  it('物化昨日 ideas 页后幂等（二次调用返回 0）', async () => {
    const client = getTestCore()!
    expect(client.snapshotStaleIdeasPages).toBeTypeOf('function')

    // 造一张昨日 ideas 页（标题 = 本地时区昨天；savePage 走 Rust create，标题唯一）
    const yesterday = yesterdayStr()
    const pageUpdate: PageUpdate = { title: yesterday, type: 'ideas', aliases: '[]' }
    const page = await client.savePage(pageUpdate)
    expect(page.type).toBe('ideas')
    expect(page.title).toBe(yesterday)

    // 物化：至少物化掉刚创建的昨日页（库中可能还有其它遗留过期页，故用 >= 1）
    const first = await client.snapshotStaleIdeasPages()
    expect(first.materialized).toBeGreaterThanOrEqual(1)

    // 幂等：二次调用不再产生新行
    const second = await client.snapshotStaleIdeasPages()
    expect(second.materialized).toBe(0)
  })
})
