import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NotificationService, getNotificationService } from './notification-service'
import { DEFAULT_NOTIFICATION_SETTINGS } from '../types/notification'
import type { CoreClient } from '../wasm/client'
import type { Notification, Block, Page, DateRefRecord } from '../wasm/types'

// 复刻 service 行为：eventIso 直接用 dateRef.iso 字面量（不再走 toISOString 时区换算），
// 避免上海时区下「火製出 UTC 字面→前端当本地解析」的双重转换偏差。
function eventIsoFromIso(iso: string, _leadMinutes = 0): string {
  return iso
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
    vi.useRealTimers()
  })

  it('settings.enabled=false 时直接返回空数组，不查询 DB', async () => {
    const tracker: CallTracker = { createdNotifications: [], updatedPayloads: [] }
    const client = makeClient({ due: [], recurring: [] }, tracker)
    const svc = new NotificationService(client)

    const fired = await svc.checkAndFire({ ...DEFAULT_NOTIFICATION_SETTINGS, enabled: false })

    expect(fired).toEqual([])
    expect(client.queryDueNonRecurringDateRefs).not.toHaveBeenCalled()
    expect(client.queryAllRecurringDateRefs).not.toHaveBeenCalled()
  })

  it('静默时段内不触发任何通知', async () => {
    vi.useFakeTimers()
    // 固定为 2026-07-24 23:00，处于 22:00~08:00 跨天静默时段内
    vi.setSystemTime(new Date(2026, 6, 24, 23, 0, 0, 0))

    const tracker: CallTracker = { createdNotifications: [], updatedPayloads: [] }
    const dueRef = makeDateRef({ id: 'due_qh', block_id: 'bq', event_ts: new Date(2026, 6, 24, 9, 0, 0, 0).getTime() })
    const client = makeClient({ due: [dueRef], recurring: [] }, tracker)
    const svc = new NotificationService(client)

    const fired = await svc.checkAndFire({
      ...DEFAULT_NOTIFICATION_SETTINGS,
      quiet_hours_start: '22:00',
      quiet_hours_end: '08:00',
    })

    expect(fired).toEqual([])
    expect(client.createNotification).not.toHaveBeenCalled()
    vi.useRealTimers()
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

  it('非 recurring dateRef 的 event_ts 缺失/为 0 时跳过 fireNotification，不创建通知', async () => {
    const tracker: CallTracker = { createdNotifications: [], updatedPayloads: [] }
    // makeDateRef 用 ?? 兜底默认值，显式传 0 模拟 event_ts 缺失/无效分支
    const dueRef = { ...makeDateRef({ id: 'due_no_ts', block_id: 'bnt' }), event_ts: 0 }
    const client = makeClient({ due: [dueRef], recurring: [] }, tracker)
    const svc = new NotificationService(client)

    const fired = await svc.checkAndFire()
    expect(fired.length).toBe(0)
    expect(client.createNotification).not.toHaveBeenCalled()
  })

  it('recurring dateRef 的下一周期 effectiveTime 在未来时不触发', async () => {
    vi.useFakeTimers()
    // 固定为 2026-07-20 12:00
    vi.setSystemTime(new Date(2026, 6, 20, 12, 0, 0, 0))

    const tracker: CallTracker = { createdNotifications: [], updatedPayloads: [] }
    // 每天 9:00，无 lead → 下一周期为 2026-07-21 09:00，effectiveTime 在未来
    const recurringRef = makeDateRef({
      id: 'rec_future',
      block_id: 'bf',
      recurrence: 'daily',
      iso: '2026-07-20T09:00',
      lead_minutes: 0,
      event_ts: new Date(2026, 6, 20, 9, 0, 0, 0).getTime(),
    })
    const client = makeClient({ due: [], recurring: [recurringRef] }, tracker)
    const svc = new NotificationService(client)

    const fired = await svc.checkAndFire()
    expect(fired.length).toBe(0)
    expect(client.createNotification).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('pending 锚点在触发时应提升为 unread 状态', async () => {
    const tracker: CallTracker = { createdNotifications: [], updatedPayloads: [] }
    const dueRef = makeDateRef({ id: 'due_pending', block_id: 'bp', iso: '2026-07-20T09:00', event_ts: new Date(2026, 6, 20, 9, 0, 0, 0).getTime() })
    const client = makeClient({ due: [dueRef], recurring: [] }, tracker) as CoreClient & {
      getNotificationsByBlock: ReturnType<typeof vi.fn>
    }
    client.getNotificationsByBlock = vi.fn(async () => [
      { id: 'n_pending', block_id: 'bp', page_id: 'page_1', kind: 'schedule', event_iso: eventIsoFromIso(dueRef.iso, dueRef.lead_minutes), fired_at: 0, status: 'pending', snooze_until: null, payload: '', created_at: 0, updated_at: 0 } as Notification,
    ])
    const svc = new NotificationService(client)

    const fired = await svc.checkAndFire()
    expect(fired.length).toBe(1)
    expect(fired[0].status).toBe('unread')
    expect(client.updateNotificationStatus).toHaveBeenCalledWith('n_pending', 'unread')
    expect(client.createNotification).not.toHaveBeenCalled()
  })

  it('unread/read 锚点直接复用，不重复创建', async () => {
    const tracker: CallTracker = { createdNotifications: [], updatedPayloads: [] }
    const dueRef = makeDateRef({ id: 'due_unread', block_id: 'bu', iso: '2026-07-20T09:00', event_ts: new Date(2026, 6, 20, 9, 0, 0, 0).getTime() })
    const existing = { id: 'n_unread', block_id: 'bu', page_id: 'page_1', kind: 'schedule', event_iso: eventIsoFromIso(dueRef.iso, dueRef.lead_minutes), fired_at: 0, status: 'unread', snooze_until: null, payload: '', created_at: 0, updated_at: 0 } as Notification
    const client = makeClient({ due: [dueRef], recurring: [] }, tracker) as CoreClient & {
      getNotificationsByBlock: ReturnType<typeof vi.fn>
    }
    client.getNotificationsByBlock = vi.fn(async () => [existing])
    const svc = new NotificationService(client)

    const fired = await svc.checkAndFire()
    expect(fired.length).toBe(1)
    expect(fired[0].id).toBe('n_unread')
    expect(client.createNotification).not.toHaveBeenCalled()
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

describe('NotificationService 周期计算与 payload 构建', () => {
  it('monthly recurrence 在下一周期 effectiveTime 到期时触发通知', async () => {
    vi.useFakeTimers()
    // 固定为 2026-07-16 12:00，base 2026-06-15 的 monthly 下一周期为 2026-08-15，
    // lead=30 天使 effectiveTime = 2026-07-16 <= now
    vi.setSystemTime(new Date(2026, 6, 16, 12, 0, 0, 0))

    const tracker: CallTracker = { createdNotifications: [], updatedPayloads: [] }
    const ref = makeDateRef({
      id: 'rec_monthly',
      block_id: 'bm',
      kind: 'schedule',
      recurrence: 'monthly',
      iso: '2026-06-15T09:00',
      lead_minutes: 30 * 24 * 60,
      event_ts: new Date(2026, 5, 15, 9, 0, 0, 0).getTime(),
    })
    const client = makeClient({ due: [], recurring: [ref] }, tracker)
    const svc = new NotificationService(client)

    const fired = await svc.checkAndFire()
    expect(fired.length).toBe(1)
    expect(client.getBlock).toHaveBeenCalledWith('bm')
    vi.useRealTimers()
  })

  it('yearly recurrence 在下一周期 effectiveTime 到期时触发通知', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 21, 12, 0, 0, 0))

    const tracker: CallTracker = { createdNotifications: [], updatedPayloads: [] }
    const ref = makeDateRef({
      id: 'rec_yearly',
      block_id: 'by',
      kind: 'deadline',
      recurrence: 'yearly',
      iso: '2025-07-20T09:00',
      lead_minutes: 365 * 24 * 60,
      event_ts: new Date(2025, 6, 20, 9, 0, 0, 0).getTime(),
    })
    const client = makeClient({ due: [], recurring: [ref] }, tracker)
    const svc = new NotificationService(client)

    const fired = await svc.checkAndFire()
    expect(fired.length).toBe(1)
    expect(client.getBlock).toHaveBeenCalledWith('by')
    vi.useRealTimers()
  })

  it('weekly recurrence 在下一周期 effectiveTime 到期时触发通知', async () => {
    vi.useFakeTimers()
    // 2026-07-22 为周三，base 2026-07-15（上周三）下一周期为 2026-07-29，
    // lead=7 天使 effectiveTime = 2026-07-22 <= now
    vi.setSystemTime(new Date(2026, 6, 22, 12, 0, 0, 0))

    const tracker: CallTracker = { createdNotifications: [], updatedPayloads: [] }
    const ref = makeDateRef({
      id: 'rec_weekly',
      block_id: 'bw',
      kind: 'schedule',
      recurrence: 'weekly',
      iso: '2026-07-15T09:00',
      lead_minutes: 7 * 24 * 60,
      event_ts: new Date(2026, 6, 15, 9, 0, 0, 0).getTime(),
    })
    const client = makeClient({ due: [], recurring: [ref] }, tracker)
    const svc = new NotificationService(client)

    const fired = await svc.checkAndFire()
    expect(fired.length).toBe(1)
    expect(client.getBlock).toHaveBeenCalledWith('bw')
    vi.useRealTimers()
  })

  it('无效的 iso 导致 calculateEventTime 返回 null，不同步 payload', async () => {
    const tracker: CallTracker = { createdNotifications: [], updatedPayloads: [] }
    const ref = makeDateRef({ id: 'bad_iso', block_id: 'bbi', iso: 'not-a-date', event_ts: 0 })
    const client = makeClient({ due: [ref], recurring: [] }, tracker) as CoreClient & {
      getNotificationsByBlock: ReturnType<typeof vi.fn>
    }
    client.getNotificationsByBlock = vi.fn(async () => [
      { id: 'n_bad', block_id: 'bbi', page_id: 'page_1', kind: 'schedule', event_iso: ref.iso, fired_at: 0, status: 'unread', snooze_until: null, payload: 'OLD', created_at: 0, updated_at: 0 } as Notification,
    ])
    const svc = new NotificationService(client)

    await svc.syncPayloadForBlock('bbi')

    expect(client.updateNotificationPayload).not.toHaveBeenCalled()
  })

  it('buildPayload 在 blockSnippet 为空时回退到 page.title', async () => {
    const tracker: CallTracker = { createdNotifications: [], updatedPayloads: [] }
    const dueRef = makeDateRef({ id: 'due_empty', block_id: 'be', iso: '2026-07-20T09:00', event_ts: new Date(2026, 6, 20, 9, 0, 0, 0).getTime() })
    const client = makeClient({ due: [dueRef], recurring: [] }, tracker) as CoreClient & {
      getBlock: ReturnType<typeof vi.fn>
    }
    client.getBlock = vi.fn(async (id: string) => ({ ...makeBlock(id), content: '{{schedule:2026-07-20T09:00}}' } as Block))
    const svc = new NotificationService(client)

    const fired = await svc.checkAndFire()

    expect(fired.length).toBe(1)
    const payload = JSON.parse(fired[0].payload)
    expect(payload.body).toBe('Daily')
    expect(payload.blockSnippet).toBe('')
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
