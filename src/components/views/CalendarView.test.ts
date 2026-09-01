import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CalendarView from './CalendarView.vue'
import type { BlockCard } from '../../wasm/types'
import type { FieldDescriptor } from '../../core/query'

function makeCard(overrides: Partial<BlockCard> = {}): BlockCard {
  const base: BlockCard = {
    block_id: 'block-1',
    page_id: 'page-1',
    parent_id: '',
    content_preview: 'Cal task',
    properties: {},
    date_refs: [],
    updated_at: 1723000000000,
    created_at: 1723000000000,
    ...overrides,
  }
  return JSON.parse(JSON.stringify(base))
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 仿 Block 注册表：content(标题) / deadline / schedule 两个 date 字段
function makeFields(): FieldDescriptor[] {
  return [
    { key: 'content', label: '内容', type: 'text', get: (i) => (i as BlockCard).content_preview },
    {
      key: 'deadline', label: '截止', type: 'date',
      get: (i) => (i as BlockCard).date_refs?.find((d) => d.kind === 'deadline')?.date_day
        ?? (i as BlockCard).date_refs?.find((d) => d.kind === 'schedule')?.date_day,
    },
    {
      key: 'schedule', label: '计划', type: 'date',
      get: (i) => (i as BlockCard).date_refs?.find((d) => d.kind === 'schedule')?.date_day,
    },
  ]
}

const fields = makeFields()

function mountCal(props: Record<string, unknown> = {}) {
  return mount(CalendarView, {
    props: {
      items: [makeCard()],
      fields,
      config: { viewKind: 'calendar', version: 1, dateRefKind: 'deadline' },
      idKey: 'block_id',
      ...props,
    },
  })
}

describe('CalendarView (generic, field-driven)', () => {
  it('renders a month grid with weekday headers', () => {
    const wrapper = mountCal({ items: [] })
    expect(wrapper.findAll('.cal-weekday').length).toBe(7)
    expect(wrapper.find('.cal-month-label').exists()).toBe(true)
  })

  it('buckets cards by deadline date field into the day cell', () => {
    const day = todayStr()
    const wrapper = mountCal({
      items: [makeCard({ content_preview: 'Today task', date_refs: [{ kind: 'deadline', iso: day, date_day: day, recurrence: 'none', event_ts: 0 }] })],
    })
    const ev = wrapper.find('.cal-event')
    expect(ev.exists()).toBe(true)
    expect(ev.text()).toContain('Today task')
  })

  it('emits navigate on event click', async () => {
    const day = todayStr()
    const wrapper = mountCal({
      items: [makeCard({ block_id: 'b1', content_preview: 'Click', date_refs: [{ kind: 'deadline', iso: day, date_day: day, recurrence: 'none', event_ts: 0 }] })],
    })
    await wrapper.find('.cal-event').trigger('click')
    expect(wrapper.emitted('navigate')).toBeTruthy()
    expect(wrapper.emitted('navigate')![0]).toEqual(['b1'])
  })

  it('buckets by schedule field when dateRefKind=schedule', () => {
    const day = todayStr()
    const wrapper = mountCal({
      config: { viewKind: 'calendar', version: 1, dateRefKind: 'schedule' },
      items: [makeCard({ content_preview: 'Plan task', date_refs: [{ kind: 'schedule', iso: day, date_day: day, recurrence: 'none', event_ts: 0 }] })],
    })
    const ev = wrapper.find('.cal-event')
    expect(ev.exists()).toBe(true)
    expect(ev.classes()).toContain('schedule')
  })

  it('renders empty hint when no dated items', () => {
    const wrapper = mountCal({ items: [] })
    expect(wrapper.find('.calendar-empty').exists()).toBe(true)
  })
})
