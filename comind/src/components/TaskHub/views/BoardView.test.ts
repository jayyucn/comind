import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import BoardView from '../views/BoardView.vue'
import type { BlockCard } from '../../../wasm/types'

function makeCard(overrides: Partial<BlockCard> = {}): BlockCard {
  return {
    block_id: 'block-1',
    page_id: 'page-1',
    parent_id: '',
    content_preview: 'Test card',
    properties: {},
    date_refs: [],
    updated_at: 1723000000000,
    ...overrides,
  }
}

describe('BoardView', () => {
  // ── Columns ──
  it('renders all 4 status columns', () => {
    const wrapper = mount(BoardView, { props: { cards: [] } })
    const columns = wrapper.findAll('.board-column')
    expect(columns).toHaveLength(4)
  })

  it('shows column headers with labels', () => {
    const wrapper = mount(BoardView, { props: { cards: [] } })
    const headers = wrapper.findAll('.column-title')
    const labels = headers.map(h => h.text())
    expect(labels.some(l => l.includes('待办'))).toBe(true)
    expect(labels.some(l => l.includes('进行中'))).toBe(true)
    expect(labels.some(l => l.includes('已完成'))).toBe(true)
    expect(labels.some(l => l.includes('已取消'))).toBe(true)
  })

  // ── Card sorting by status ──
  it('places cards in correct status column', () => {
    const cards = [
      makeCard({ block_id: 'b1', content_preview: 'Todo task', properties: { status: 'Todo' } }),
      makeCard({ block_id: 'b2', content_preview: 'Doing task', properties: { status: 'Doing' } }),
      makeCard({ block_id: 'b3', content_preview: 'Done task', properties: { status: 'Done' } }),
      makeCard({ block_id: 'b4', content_preview: 'Canceled task', properties: { status: 'Canceled' } }),
    ]
    const wrapper = mount(BoardView, { props: { cards } })

    const todoCol = wrapper.findAll('.board-column')[0]
    expect(todoCol.text()).toContain('Todo task')
    expect(todoCol.text()).not.toContain('Doing task')

    const doingCol = wrapper.findAll('.board-column')[1]
    expect(doingCol.text()).toContain('Doing task')

    const doneCol = wrapper.findAll('.board-column')[2]
    expect(doneCol.text()).toContain('Done task')

    const canceledCol = wrapper.findAll('.board-column')[3]
    expect(canceledCol.text()).toContain('Canceled task')
  })

  it('defaults to "Todo" when status property is missing', () => {
    const cards = [makeCard({ content_preview: 'Fresh card', properties: {} })]
    const wrapper = mount(BoardView, { props: { cards } })
    const todoCol = wrapper.findAll('.board-column')[0]
    expect(todoCol.text()).toContain('Fresh card')
  })

  // ── Empty column state ──
  it('shows empty hint in columns with no cards', () => {
    const cards = [makeCard({ properties: { status: 'Todo' } })]
    const wrapper = mount(BoardView, { props: { cards } })
    const doingCol = wrapper.findAll('.board-column')[1]
    expect(doingCol.find('.column-empty').exists()).toBe(true)
    expect(doingCol.find('.column-empty').text()).toBe('暂无卡片')
  })

  // ── Column count ──
  it('shows card counts per column', () => {
    const cards = [
      makeCard({ block_id: 'b1', properties: { status: 'Todo' } }),
      makeCard({ block_id: 'b2', properties: { status: 'Todo' } }),
      makeCard({ block_id: 'b3', properties: { status: 'Doing' } }),
    ]
    const wrapper = mount(BoardView, { props: { cards } })
    const counts = wrapper.findAll('.column-count')
    expect(counts[0].text()).toBe('2')
    expect(counts[1].text()).toBe('1')
    expect(counts[2].text()).toBe('0')
    expect(counts[3].text()).toBe('0')
  })

  // ── Priority badge on card ──
  it('renders priority badge on board card', () => {
    const cards = [makeCard({ properties: { priority: 'P0' } })]
    const wrapper = mount(BoardView, { props: { cards } })
    expect(wrapper.find('.card-priority').exists()).toBe(true)
    expect(wrapper.find('.card-priority').text()).toBe('P0')
  })

  it('hides priority when not set', () => {
    const cards = [makeCard({ properties: {} })]
    const wrapper = mount(BoardView, { props: { cards } })
    expect(wrapper.find('.card-priority').exists()).toBe(false)
  })

  // ── Deadline on card ──
  it('renders deadline on board card', () => {
    const date = new Date()
    date.setDate(date.getDate() + 7)
    const dateStr = date.toISOString().slice(0, 10)
    const cards = [makeCard({
      date_refs: [{ kind: 'deadline', iso: dateStr, date_day: dateStr, recurrence: 'none', event_ts: 0 }],
    })]
    const wrapper = mount(BoardView, { props: { cards } })
    expect(wrapper.find('.card-deadline').exists()).toBe(true)
  })

  it('marks overdue deadline on card', () => {
    const cards = [makeCard({
      date_refs: [{ kind: 'deadline', iso: '2020-01-01', date_day: '2020-01-01', recurrence: 'none', event_ts: 0 }],
    })]
    const wrapper = mount(BoardView, { props: { cards } })
    expect(wrapper.find('.card-deadline.overdue').exists()).toBe(true)
  })

  // ── Drag & drop attributes ──
  it('marks board cards as draggable', () => {
    const cards = [makeCard()]
    const wrapper = mount(BoardView, { props: { cards } })
    const card = wrapper.find('.board-card')
    expect(card.attributes('draggable')).toBe('true')
  })

  // ── Navigate on click ──
  it('emits navigateToBlock when card clicked', async () => {
    const cards = [makeCard({ block_id: 'b1', content_preview: 'Click me' })]
    const wrapper = mount(BoardView, { props: { cards } })
    await wrapper.find('.board-card').trigger('click')
    expect(wrapper.emitted('navigateToBlock')).toBeTruthy()
    expect(wrapper.emitted('navigateToBlock')![0]).toEqual(['b1'])
  })

  // ── Drop emits statusChange ──
  it('emits statusChange on drop', async () => {
    const cards = [makeCard({ block_id: 'b1', properties: { status: 'Todo' } })]
    const wrapper = mount(BoardView, { props: { cards } })
    const doingCol = wrapper.findAll('.board-column')[1]

    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      getData: () => 'b1',
      setData: () => {},
    } as unknown as DataTransfer

    await doingCol.trigger('drop', { dataTransfer })
    expect(wrapper.emitted('statusChange')).toBeTruthy()
    expect(wrapper.emitted('statusChange')![0]).toEqual(['b1', 'Doing'])
  })
})
