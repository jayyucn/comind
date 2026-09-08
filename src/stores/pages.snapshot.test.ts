/**
 * Ideas 页快照读取守卫 — store 级测试（issue #70 — ADR-0042 T5，Seam ②）
 *
 * 与 Seam ①（Rust 单测）/ Seam ③（wasm 冒烟）互补：这里以真实 sqljs 内存库 +
 * pinia store（usePageStore.getIdeasSnapshot）驱动快照读取链路，断言：
 * - 仅「标题日期 < 今天的 ideas 页」能读到快照内容（历史页走快照）
 * - 今日页 / 无快照页读取为 null（今日页仍走活数据）
 * - 快照内容含当日任务属性（status=Todo），且守卫判定与 Rust 物化判定一致
 */
import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { getTestCore } from '../../tests/core-client'
import { isStaleIdeasPage } from '../utils/ideas-snapshot'
import { usePageStore } from './pages'
import type { BlockUpdate } from '../wasm/types'

/** 本地时区 yyyy-MM-dd（与双端「今天」判定一致，勿用 UTC） */
function localDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function todayStr(): string {
  return localDateStr(new Date())
}

function yesterdayStr(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return localDateStr(d)
}

describe('Ideas 页快照读取守卫（Seam ② store 级）', () => {
  it('仅历史 ideas 页读取到快照；今日页/无快照页为 null', async () => {
    const client = getTestCore()!
    setActivePinia(createPinia())
    const pageStore = usePageStore()

    const today = todayStr()
    const yesterday = yesterdayStr()

    // ── 造数：昨日 ideas 页（含任务块 status=Todo）+ 今日 ideas 页 ──
    const todayPage = await pageStore.ensureTodayIdeasPage()
    expect(todayPage.title).toBe(today)

    const yesterdayPage = await pageStore.createPage(yesterday, 'ideas')
    expect(yesterdayPage.type).toBe('ideas')

    const [saved] = await client.saveBlockTree([{
      id: crypto.randomUUID(),
      page_id: yesterdayPage.id,
      parent_id: null,
      pos: 1000,
      content: '写周报',
      format: '{}',
      type: 'bullet',
      created_at: Date.now(),
      updated_at: Date.now(),
    } satisfies BlockUpdate])
    const taskBlockId = saved.block.id
    await client.setProperty(taskBlockId, 'status', 'Todo', 'string')

    // ── 守卫：仅历史页走快照（纯函数，与 Rust 物化判定镜像）──
    expect(isStaleIdeasPage({ type: 'ideas', title: yesterday }, today)).toBe(true)
    expect(isStaleIdeasPage({ type: 'ideas', title: today }, today)).toBe(false)

    // ── 物化后再读：昨日页有快照内容 ──
    const materialized = await client.snapshotStaleIdeasPages()
    expect(materialized.materialized).toBeGreaterThanOrEqual(1)

    const historySnapshot = await pageStore.getIdeasSnapshot(yesterdayPage.id)
    expect(historySnapshot).not.toBeNull()
    expect(historySnapshot!.blocks.length).toBeGreaterThanOrEqual(1)
    const taskProps = historySnapshot!.properties[taskBlockId]
    expect(taskProps).toBeDefined()
    expect(taskProps.some(p => p.key === 'status' && p.value === 'Todo')).toBe(true)

    // ── 今日页：读取为 null（页面渲染仍走活数据）──
    expect(await pageStore.getIdeasSnapshot(todayPage.id)).toBeNull()
  })
})
