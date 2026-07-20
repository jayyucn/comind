import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NotificationService, getNotificationService } from './notification-service'
import type { CoreClient } from '../wasm/client'
import type { Notification, Block, Page, DateRefRecord } from '../wasm/types'

// 复刻 TS 侧 calculateEventTime 的 event_iso 计算（固定 9:00 本地），用于测试桩对齐。
function eventIsoFromIso(iso: string, leadMinutes = 0): string {
  const d = new Date(iso)
  d.setHours(9, 0, 0, 0)
  const eventTime = d.getTime() - leadMinutes * 60 * 1000
  return new Date(eventTime).toISOString().slice(0, 16)
}

function makeNow(): number {
  // 以测试运行时的真实时间为基准，避免与 Date.now() 错位
  return Date.now()
}

function makeDateRef(partial: Partial<DateRefRecord>): DateRefRecord {
  return {
    id: partial.id ?? 'ref_1',
    block_id: partial.block_id ?? 'block_1',
    kind: partial.kind ?? 'schedule',
    iso: partial.iso ?? '2026-07-20T14:00',
    date_day: partial.date_day ?? '2026-07-20',
    recurrence: partial.recurrence ?? 'none',
    lead_minutes: partial.lead_minutes ?? 0,
    event_ts: partial.event_ts ?? new Date(2026, 6, 20, 9, 0, 0, 0).getTime(),
    created_at: partial.created_at ?? 0,
  }
}

function makeBlock(blockId = 'block_1', pageId = 'page_1'): Block {
  return {
    id: blockId,
    page_id: pageId,
    parent_id: null,
    pos: 0,
    content: 'standup meeting',
    format: '{}',
    type: 'text',
    created_at: 0,
    updated_at: 0,
  } as Block
}

function makePage(pageId = 'page_1'): Page {
  return { id: pageId, title: 'Daily', content: '', created_at: 0, updated_at: 0 } as Page
}

interface CallTracker {
  createdNotifications: Notification[]
  updatedPayloads: Array<{ id: string; payload: string }>
}

function makeClient(refs: { due: DateRefRecord[]; recurring: DateRefRecord[] }, tracker: CallTracker): CoreClient {
  const existingByKey = new Map<string, Notification>()
  return {
    queryDueNonRecurringDateRefs: vi.fn(async (now: number) =>
      refs.due.filter((r) => r.event_ts - (r.lead_minutes || 0) * 60000 <= now),
    ),
    queryAllRecurringDateRefs: vi.fn(async () => refs.recurring),
    getBlock: vi.fn(async (id: string) => makeBlock(id)),
    getPage: vi.fn(async () => makePage()),
    getDateRefsByBlock: vi.fn(async () => refs.due.concat(refs.recurring)),
    getNotificationsByBlock: vi.fn(async (blockId: string) => existingByKey.get(blockId) ? [existingByKey.get(blockId)!] : []),
    createNotification: vi.fn(async (n: Notification) => {
      tracker.createdNotifications.push(n)
      return n
    }),
    updateNotificationPayload: vi.fn(async (id: string, payload: string) => {
      tracker.updatedPayloads.push({ id, payload })
      return {} as Notification
    }),
    updateNotificationStatus: vi.fn(async (id: string, status: string) => ({ id, status } as Notification)),
    cleanupNotifications: vi.fn(async () => {}),
    // 其余方法在测试中不会触发，用 no-op 兜底
    queryUnreadNotifications: vi.fn(async () => []),
    queryRecentNotifications: vi.fn(async () => []),
    getNotification: vi.fn(async () => ({}) as Notification),
    markAllNotificationsRead: vi.fn(async () => {}),
    setNotificationSnooze: vi.fn(async () => ({}) as Notification),
    deleteNotification: vi.fn(async () => {}),
  } as unknown as CoreClient
}

describe('NotificationService.checkAndFire (性能优化方案 A)', () => {
  beforeEach(() => {
    // 共享单例基于 client 惰性创建，每用例用新 client 即可隔离
  })

  it('只遍历到期非 recurring 的 dueRefs，不为全部 page/block 发起查询', async () => {
    const tracker: CallTracker = { createdNotifications: [], updatedPayloads: [] }
    const dueRef = makeDateRef({ id: 'due_1', block_id: 'b1', iso: '2026-07-20T09:00', event_ts: new Date(2026, 6, 20, 9, 0, 0, 0).getTime() })
    const client = makeClient({ due: [dueRef], recurring: [] }, tracker)
    const svc = new NotificationService(client)

    const fired = await svc.checkAndFire()

    // 每次 checkAndFire 仅两次 dateRef 查询 + 按到期条目各一次 block/page 查询
    expect(client.queryDueNonRecurringDateRefs).toHaveBeenCalledTimes(1)
    expect(client.queryAllRecurringDateRefs).toHaveBeenCalledTimes(1)
    expect(client.getBlock).toHaveBeenCalledTimes(1)
    expect(client.getPage).toHaveBeenCalledTimes(1)
    // 不再调用全量回写的 updateNotificationPayload
    expect(client.updateNotificationPayload).not.toHaveBeenCalled()
    expect(fired.length).toBe(1)
  })

  it('未到期的 dueRef（event_ts - lead > now）不被 DB 查询返回，故不触发通知', async () => {
    const tracker: CallTracker = { createdNotifications: [], updatedPayloads: [] }
    const futureRef = makeDateRef({ id: 'future', block_id: 'b2', event_ts: makeNow() + 60 * 60 * 1000 })
    const client = makeClient({ due: [futureRef], recurring: [] }, tracker)
    const svc = new NotificationService(client)

    const fired = await svc.checkAndFire()
    expect(fired.length).toBe(0)
    expect(client.createNotification).not.toHaveBeenCalled()
  })

  it('recurring 计算到下一周期(含 lead) <= now 时触发', async () => {
    const tracker: CallTracker = { createdNotifications: [], updatedPayloads: [] }
    // 每天 9:00 的事件，lead_minutes=1440(提前 1 天) → effectiveTime = 今天 9:00 <= now(12:00)，应触发。
    const recurringRef = makeDateRef({
      id: 'rec_1',
      block_id: 'b3',
      recurrence: 'daily',
      iso: '2026-07-20T08:00',
      lead_minutes: 1440,
      event_ts: new Date(2026, 6, 20, 9, 0, 0, 0).getTime(),
    })
    const client = makeClient({ due: [], recurring: [recurringRef] }, tracker)
    const svc = new NotificationService(client)

    const fired = await svc.checkAndFire()
    expect(fired.length).toBe(1)
    expect(client.getBlock).toHaveBeenCalledWith('b3')
  })

  it('dismissed 锚点不重建/不重吐', async () => {
    const tracker: CallTracker = { createdNotifications: [], updatedPayloads: [] }
    const dueRef = makeDateRef({ id: 'due_dismiss', block_id: 'bd', iso: '2026-07-20T09:00', event_ts: new Date(2026, 6, 20, 9, 0, 0, 0).getTime() })
    const client = makeClient({ due: [dueRef], recurring: [] }, tracker) as CoreClient & {
      getNotificationsByBlock: ReturnType<typeof vi.fn>
    }
    // 预置一个 dismissed 通知作为去重锚点
    client.getNotificationsByBlock = vi.fn(async () => [
      { id: 'n_dismiss', block_id: 'bd', page_id: 'page_1', kind: 'schedule', event_iso: eventIsoFromIso(dueRef.iso, dueRef.lead_minutes), fired_at: 0, status: 'dismissed', snooze_until: null, payload: '', created_at: 0, updated_at: 0 } as Notification,
    ])
    const svc = new NotificationService(client)

    const fired = await svc.checkAndFire()
    expect(fired.length).toBe(0)
    expect(client.createNotification).not.toHaveBeenCalled()
    // fireNotification 复用了 existing（dismissed）而跳过，不会再次 updateNotificationStatus 提升
    expect(client.updateNotificationStatus).not.toHaveBeenCalled()
  })
})

describe('NotificationService.syncPayloadForBlock (编辑路径事件驱动)', () => {
  it('仅对未 dismissed 的已存在通知回写 payload，不改写 dismissed 锚点', async () => {
    const tracker: CallTracker = { createdNotifications: [], updatedPayloads: [] }
    const ref = makeDateRef({ id: 'sb', block_id: 'bx', event_ts: makeNow() + 24 * 3600 * 1000 })
    const client = makeClient({ due: [ref], recurring: [] }, tracker) as CoreClient & {
      getNotificationsByBlock: ReturnType<typeof vi.fn>
    }
    const eventIso = eventIsoFromIso(ref.iso, ref.lead_minutes)
    client.getNotificationsByBlock = vi.fn(async () => [
      { id: 'n_active', block_id: 'bx', page_id: 'page_1', kind: 'schedule', event_iso: eventIso, fired_at: 0, status: 'unread', snooze_until: null, payload: 'OLD', created_at: 0, updated_at: 0 } as Notification,
    ])
    const svc = new NotificationService(client)

    await svc.syncPayloadForBlock('bx')

    expect(client.updateNotificationPayload).toHaveBeenCalledTimes(1)
    const arg = tracker.updatedPayloads[0]
    expect(arg.id).toBe('n_active')
    expect(arg.payload).not.toBe('OLD')
  })

  it('dismissed 通知的 payload 不被回写', async () => {
    const tracker: CallTracker = { createdNotifications: [], updatedPayloads: [] }
    const ref = makeDateRef({ id: 'sb2', block_id: 'bx2', event_ts: makeNow() + 24 * 3600 * 1000 })
    const client = makeClient({ due: [ref], recurring: [] }, tracker) as CoreClient & {
      getNotificationsByBlock: ReturnType<typeof vi.fn>
    }
    const eventIso = eventIsoFromIso(ref.iso, ref.lead_minutes)
    client.getNotificationsByBlock = vi.fn(async () => [
      { id: 'n_dismiss2', block_id: 'bx2', page_id: 'page_1', kind: 'schedule', event_iso: eventIso, fired_at: 0, status: 'dismissed', snooze_until: null, payload: 'OLD', created_at: 0, updated_at: 0 } as Notification,
    ])
    const svc = new NotificationService(client)

    await svc.syncPayloadForBlock('bx2')
    expect(client.updateNotificationPayload).not.toHaveBeenCalled()
  })
})

describe('getNotificationService 共享单例', () => {
  it('同一 client 返回同一实例', () => {
    const client = makeClient({ due: [], recurring: [] }, { createdNotifications: [], updatedPayloads: [] })
    const a = getNotificationService(client)
    const b = getNotificationService(client)
    expect(a).toBe(b)
  })
})
