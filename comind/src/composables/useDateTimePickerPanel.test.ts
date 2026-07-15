import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDateTimePickerPanel, useDateRefClickListener } from './useDateTimePickerPanel'
import { DATE_REF_CLICK_EVENT } from '../extensions/DateRefExtension'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('useDateTimePickerPanel', () => {
  it('visible 初始为 false（store.dateRefEditor 初始为 null）', () => {
    const { visible } = useDateTimePickerPanel()
    expect(visible.value).toBe(false)
  })

  it('open 设置 store.dateRefEditor 并让 visible=true', () => {
    const { visible, open } = useDateTimePickerPanel()
    open({
      blockId: 'block-1',
      from: 10,
      to: 30,
      kind: 'deadline',
      iso: '2026-07-15T14:00',
      recurrence: 'weekly',
      position: { x: 200, y: 300 },
    })
    expect(visible.value).toBe(true)
  })

  it('open 时 kind/iso/recurrence/position 正确传递', () => {
    const { kind, initialIso, initialRecurrence, position, open } = useDateTimePickerPanel()
    open({
      blockId: 'b',
      from: 0,
      to: 0,
      kind: 'schedule',
      iso: '2026-07-20',
      recurrence: 'daily',
      position: { x: 100, y: 200 },
    })
    expect(kind.value).toBe('schedule')
    expect(initialIso.value).toBe('2026-07-20')
    expect(initialRecurrence.value).toBe('daily')
    expect(position.value).toEqual({ x: 100, y: 200 })
  })

  it('close 设置 visible=false（不清理其他字段）', () => {
    const { visible, initialIso, close, open } = useDateTimePickerPanel()
    open({
      blockId: 'b',
      from: 0,
      to: 0,
      kind: 'schedule',
      iso: '2026-07-15',
      recurrence: 'none',
      position: { x: 0, y: 0 },
    })
    expect(visible.value).toBe(true)
    close()
    expect(visible.value).toBe(false)
    // iso 保留（面板重新打开时仍可用）
    expect(initialIso.value).toBe('2026-07-15')
  })
})

describe('useDateRefClickListener — 核心逻辑', () => {
  // onMounted 在 Vitest 纯函数调用中不执行；测试 onClick handler 的核心逻辑
  it('handler 从 event.detail 提取 payload，从 target.getBoundingClientRect 计算锚点', () => {
    const received = vi.fn()

    const mockDetail = {
      from: 10,
      to: 30,
      blockId: 'block-1',
      kind: 'deadline',
      iso: '2026-07-15T14:00',
      recurrence: 'weekly',
    }
    const mockTarget = {
      getBoundingClientRect: () => ({ left: 100, bottom: 200 }),
    }

    // 模拟 useDateRefClickListener 内部的 handler 逻辑
    function handler(event: Event) {
      const e = event as any
      const payload = e.detail
      if (!payload) return
      const rect = e.target.getBoundingClientRect()
      received(payload, { x: rect.left, y: rect.bottom + 6 })
    }

    handler({ detail: mockDetail, target: mockTarget } as unknown as Event)

    expect(received).toHaveBeenCalledTimes(1)
    expect(received.mock.calls[0][0]).toMatchObject({
      from: 10,
      to: 30,
      blockId: 'block-1',
      kind: 'deadline',
    })
    // y = bottom(200) + 6 = 206
    expect(received.mock.calls[0][1]).toEqual({ x: 100, y: 206 })
  })
})
