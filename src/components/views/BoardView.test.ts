import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import BoardView from './BoardView.vue'
import type { BlockCard } from '../../wasm/types'
import type { FieldDescriptor } from '../../core/query'

function makeCard(overrides: Partial<BlockCard> = {}): BlockCard {
  const base: BlockCard = {
    block_id: 'block-1',
    page_id: 'page-1',
    parent_id: '',
    content_preview: 'Test card',
    properties: {},
    date_refs: [],
    updated_at: 1723000000000,
    created_at: 1723000000000,
    ...overrides,
  }
  return JSON.parse(JSON.stringify(base))
}

// 仿 Block 注册表：status(分组) / content(标题) / priority(带色) / deadline(date)
function makeFields(): FieldDescriptor[] {
  return [
    { key: 'content', label: '内容', type: 'text', get: (i) => (i as BlockCard).content_preview },
    {
      key: 'status', label: '状态', type: 'select',
      options: [
        { id: 'Todo', label: '待办', color: '#9CA3AF' },
        { id: 'Doing', label: '进行中', color: '#D97706' },
        { id: 'Done', label: '已完成', color: '#10B981' },
        { id: 'Canceled', label: '已取消', color: '#9CA3AF' },
      ],
      get: (i) => (i as BlockCard).properties?.['status'] ?? 'Todo',
    },
    {
      key: 'priority', label: '优先级', type: 'select',
      options: [
        { id: 'Low', label: '低', color: '#9CA3AF' },
        { id: 'High', label: '高', color: '#F59E0B' },
      ],
      get: (i) => (i as BlockCard).properties?.['priority'],
    },
    {
      key: 'deadline', label: '截止', type: 'date',
      get: (i) => (i as BlockCard).date_refs?.find((d) => d.kind === 'deadline')?.date_day
        ?? (i as BlockCard).date_refs?.find((d) => d.kind === 'schedule')?.date_day,
    },
  ]
}

const fields = makeFields()

function mountBoard(props: Record<string, unknown> = {}) {
  return mount(BoardView, {
    props: {
      items: [makeCard()],
      fields,
      groupBy: 'status',
      config: { viewKind: 'board', version: 1, cardFields: ['priority', 'deadline'] },
      idKey: 'block_id',
      ...props,
    },
  })
}

describe('BoardView (generic, field-driven)', () => {
  it('derives columns from groupBy field options', () => {
    const wrapper = mountBoard({ items: [] })
    const titles = wrapper.findAll('.column-title').map((t) => t.text())
    expect(titles).toContain('待办')
    expect(titles).toContain('进行中')
    expect(titles).toContain('已完成')
    expect(titles).toContain('已取消')
  })

  it('places cards into matching group columns', () => {
    const cards = [
      makeCard({ block_id: 'b1', content_preview: 'Todo task', properties: { status: 'Todo' } }),
      makeCard({ block_id: 'b2', content_preview: 'Doing task', properties: { status: 'Doing' } }),
      makeCard({ block_id: 'b3', content_preview: 'Done task', properties: { status: 'Done' } }),
    ]
    const wrapper = mountBoard({ items: cards })
    const cols = wrapper.findAll('.board-column')
    expect(cols[0].text()).toContain('Todo task')
    expect(cols[1].text()).toContain('Doing task')
    expect(cols[2].text()).toContain('Done task')
  })

  it('defaults missing group value to first column (Todo)', () => {
    const wrapper = mountBoard({ items: [makeCard({ content_preview: 'Fresh', properties: {} })] })
    expect(wrapper.findAll('.board-column')[0].text()).toContain('Fresh')
  })

  it('shows card counts per column', () => {
    const cards = [
      makeCard({ block_id: 'b1', properties: { status: 'Todo' } }),
      makeCard({ block_id: 'b2', properties: { status: 'Todo' } }),
      makeCard({ block_id: 'b3', properties: { status: 'Doing' } }),
    ]
    const wrapper = mountBoard({ items: cards })
    const counts = wrapper.findAll('.column-count')
    expect(counts[0].text()).toBe('2')
    expect(counts[1].text()).toBe('1')
  })

  it('renders colored chip for priority (Option.color)', () => {
    const wrapper = mountBoard({ items: [makeCard({ properties: { priority: 'High' } })] })
    expect(wrapper.find('.card-chip').exists()).toBe(true)
    expect(wrapper.find('.card-chip').text()).toContain('高')
  })

  it('renders overdue deadline chip', () => {
    const wrapper = mountBoard({
      items: [makeCard({ date_refs: [{ kind: 'deadline', iso: '2020-01-01', date_day: '2020-01-01', recurrence: 'none', event_ts: 0 }] })],
    })
    const chip = wrapper.find('.card-chip.overdue')
    expect(chip.exists()).toBe(true)
  })

  it('hides chips when cardFields empty', () => {
    const wrapper = mountBoard({
      items: [makeCard({ properties: { priority: 'High' } })],
      config: { viewKind: 'board', version: 1 },
    })
    expect(wrapper.find('.card-chip').exists()).toBe(false)
  })

  it('marks cards draggable', () => {
    const wrapper = mountBoard()
    expect(wrapper.find('.board-card').attributes('draggable')).toBe('true')
  })

  it('emits navigate on card click', async () => {
    const wrapper = mountBoard({ items: [makeCard({ block_id: 'b1', content_preview: 'Click me' })] })
    await wrapper.find('.board-card').trigger('click')
    expect(wrapper.emitted('navigate')).toBeTruthy()
    expect(wrapper.emitted('navigate')![0]).toEqual(['b1'])
  })

  it('emits cellChange on drop to a column', async () => {
    const wrapper = mountBoard({ items: [makeCard({ block_id: 'b1', properties: { status: 'Todo' } })] })
    const doingCol = wrapper.findAll('.board-column')[1]
    const dataTransfer = { effectAllowed: '', dropEffect: '', getData: () => 'b1', setData: () => {} } as unknown as DataTransfer
    await doingCol.trigger('drop', { dataTransfer })
    expect(wrapper.emitted('cellChange')).toBeTruthy()
    expect(wrapper.emitted('cellChange')![0]).toEqual(['b1', 'status', 'Doing'])
  })
})
