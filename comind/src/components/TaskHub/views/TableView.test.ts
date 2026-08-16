import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TableView from '../views/TableView.vue'
import type { BlockCard } from '../../../wasm/types'
import type { Group, SortRule } from '../../../core/query'

function makeCard(overrides: Partial<BlockCard> = {}): BlockCard {
  const base: BlockCard = {
    block_id: 'block-1',
    page_id: 'page-1',
    parent_id: '',
    content_preview: 'Test task item',
    properties: {},
    date_refs: [],
    updated_at: 1723000000000,
    ...overrides,
  }
  return JSON.parse(JSON.stringify(base))
}

const noSort: SortRule[] = []
const noGroups: Group<BlockCard>[] = []

describe('TableView', () => {
  // ── Empty state ──
  it('renders empty state when no cards', () => {
    const wrapper = mount(TableView, {
      props: { cards: [], groups: noGroups, grouped: false, sort: noSort },
    })
    expect(wrapper.text()).toContain('没有匹配的任务')
    expect(wrapper.find('table').exists()).toBe(false)
  })

  // ── Table header ──
  it('renders table with header columns', () => {
    const wrapper = mount(TableView, {
      props: { cards: [makeCard()], groups: noGroups, grouped: false, sort: noSort },
    })
    const ths = wrapper.findAll('th')
    const headers = ths.map(th => th.text().trim())
    expect(headers.some(h => h.includes('内容'))).toBe(true)
    expect(headers.some(h => h.includes('状态'))).toBe(true)
    expect(headers.some(h => h.includes('优先级'))).toBe(true)
    expect(headers.some(h => h.includes('项目'))).toBe(true)
    expect(headers.some(h => h.includes('截止'))).toBe(true)
    expect(headers.some(h => h.includes('页面'))).toBe(true)
  })

  // ── Sort icon in header ──
  it('shows sort direction indicator when sort has property field', () => {
    const wrapper = mount(TableView, {
      props: { cards: [makeCard()], groups: noGroups, grouped: false, sort: [{ field: 'priority', dir: 'asc' }] },
    })
    const headerText = wrapper.find('thead').text()
    expect(headerText).toContain('↑')
  })

  it('shows sort dir for content field', () => {
    const wrapper = mount(TableView, {
      props: { cards: [makeCard()], groups: noGroups, grouped: false, sort: [{ field: 'content', dir: 'desc' }] },
    })
    const headerText = wrapper.find('thead').text()
    expect(headerText).toContain('↓')
  })

  // ── Row rendering ──
  it('renders card content preview in table', () => {
    const wrapper = mount(TableView, {
      props: {
        cards: [makeCard({ content_preview: 'Buy groceries' })],
        groups: noGroups,
        grouped: false,
        sort: noSort,
      },
    })
    expect(wrapper.text()).toContain('Buy groceries')
  })

  // ── Done state ──
  it('applies done style and shows CheckSquare for Done cards', () => {
    const wrapper = mount(TableView, {
      props: {
        cards: [makeCard({ content_preview: 'Completed task', properties: { status: 'Done' } })],
        groups: noGroups,
        grouped: false,
        sort: noSort,
      },
    })
    expect(wrapper.find('.is-done').exists()).toBe(true)
  })

  // ── Status column ──
  it('renders status dropdown', () => {
    const wrapper = mount(TableView, {
      props: {
        cards: [makeCard({ properties: { status: 'Doing' } })],
        groups: noGroups,
        grouped: false,
        sort: noSort,
      },
    })
    const select = wrapper.find('select')
    expect(select.exists()).toBe(true)
    const options = select.findAll('option')
    const opts = options.map(o => o.text())
    expect(opts).toContain('Todo')
    expect(opts).toContain('Doing')
    expect(opts).toContain('Done')
    expect(opts).toContain('Canceled')
  })

  it('defaults status to "Todo" when property is missing', () => {
    const wrapper = mount(TableView, {
      props: {
        cards: [makeCard({ properties: {} })],
        groups: noGroups,
        grouped: false,
        sort: noSort,
      },
    })
    const select = wrapper.find('select')
    expect((select.element as HTMLSelectElement).value).toBe('Todo')
  })

  // ── Priority badge ──
  it('renders priority badge with correct text', () => {
    const wrapper = mount(TableView, {
      props: {
        cards: [makeCard({ properties: { priority: 'P0' } })],
        groups: noGroups,
        grouped: false,
        sort: noSort,
      },
    })
    expect(wrapper.find('.priority-badge').exists()).toBe(true)
    expect(wrapper.find('.priority-badge').text()).toBe('P0')
  })

  it('does not render priority badge when no priority', () => {
    const wrapper = mount(TableView, {
      props: {
        cards: [makeCard({ properties: {} })],
        groups: noGroups,
        grouped: false,
        sort: noSort,
      },
    })
    expect(wrapper.find('.priority-badge').exists()).toBe(false)
  })

  // ── Project ──
  it('renders project name', () => {
    const wrapper = mount(TableView, {
      props: {
        cards: [makeCard({ properties: { project: 'comind' } })],
        groups: noGroups,
        grouped: false,
        sort: noSort,
      },
    })
    expect(wrapper.text()).toContain('comind')
  })

  // ── Deadline rendering ──
  it('renders future deadline with amber color', () => {
    const futureDate = new Date()
    futureDate.setDate(futureDate.getDate() + 5)
    const dateStr = futureDate.toISOString().slice(0, 10)

    const wrapper = mount(TableView, {
      props: {
        cards: [makeCard({
          date_refs: [{ kind: 'deadline', iso: dateStr, date_day: dateStr, recurrence: 'none', event_ts: 0 }],
        })],
        groups: noGroups,
        grouped: false,
        sort: noSort,
      },
    })
    expect(wrapper.find('.deadline-text').exists()).toBe(true)
    expect(wrapper.find('.deadline-text.overdue').exists()).toBe(false)
  })

  it('renders overdue deadline with red', () => {
    const pastDate = '2020-01-01'
    const wrapper = mount(TableView, {
      props: {
        cards: [makeCard({
          date_refs: [{ kind: 'deadline', iso: pastDate, date_day: pastDate, recurrence: 'none', event_ts: 0 }],
        })],
        groups: noGroups,
        grouped: false,
        sort: noSort,
      },
    })
    expect(wrapper.find('.deadline-text.overdue').exists()).toBe(true)
  })

  it('shows future deadline without overdue or schedule class', () => {
    const futureDate = new Date()
    futureDate.setDate(futureDate.getDate() + 3)
    const dateStr = futureDate.toISOString().slice(0, 10)

    const wrapper = mount(TableView, {
      props: {
        cards: [makeCard({
          date_refs: [{ kind: 'deadline', iso: dateStr, date_day: dateStr, recurrence: 'none', event_ts: 0 }],
        })],
        groups: noGroups,
        grouped: false,
        sort: noSort,
      },
    })
    expect(wrapper.find('.deadline-text').exists()).toBe(true)
    expect(wrapper.find('.deadline-text.overdue').exists()).toBe(false)
  })

  it('renders no deadline info when no date_refs', () => {
    const wrapper = mount(TableView, {
      props: {
        cards: [makeCard({ date_refs: [] })],
        groups: noGroups,
        grouped: false,
        sort: noSort,
      },
    })
    expect(wrapper.find('.deadline-text').exists()).toBe(false)
  })

  // ── Done count ──
  it('shows correct done count in header', () => {
    const wrapper = mount(TableView, {
      props: {
        cards: [
          makeCard({ block_id: 'b1', properties: { status: 'Done' } }),
          makeCard({ block_id: 'b2', properties: { status: 'Todo' } }),
          makeCard({ block_id: 'b3', properties: { status: 'Doing' } }),
        ],
        groups: noGroups,
        grouped: false,
        sort: noSort,
      },
    })
    expect(wrapper.find('.done-count').text()).toBe('1/3')
  })

  it('shows 0/n when no done cards', () => {
    const wrapper = mount(TableView, {
      props: {
        cards: [makeCard({ properties: { status: 'Todo' } })],
        groups: noGroups,
        grouped: false,
        sort: noSort,
      },
    })
    expect(wrapper.find('.done-count').text()).toBe('0/1')
  })

  // ── Emits ──
  it('emits navigateToBlock when row clicked', async () => {
    const wrapper = mount(TableView, {
      props: { cards: [makeCard({ block_id: 'b1' })], groups: noGroups, grouped: false, sort: noSort },
    })
    await wrapper.find('.task-row').trigger('click')
    expect(wrapper.emitted('navigateToBlock')).toBeTruthy()
    expect(wrapper.emitted('navigateToBlock')![0]).toEqual(['b1'])
  })

  it('emits statusChange when checkbox clicked (toggle Done↔Todo)', async () => {
    const card = makeCard({ block_id: 'b1', properties: { status: 'Todo' } })
    const wrapper = mount(TableView, {
      props: { cards: [card], groups: noGroups, grouped: false, sort: noSort },
    })
    await wrapper.find('.check-btn').trigger('click')
    expect(wrapper.emitted('statusChange')).toBeTruthy()
    expect(wrapper.emitted('statusChange')![0]).toEqual(['b1', 'Done'])
  })

  it('toggles from Done to Todo', async () => {
    const card = makeCard({ block_id: 'b2', properties: { status: 'Done' } })
    const wrapper = mount(TableView, {
      props: { cards: [card], groups: noGroups, grouped: false, sort: noSort },
    })
    await wrapper.find('.check-btn').trigger('click')
    expect(wrapper.emitted('statusChange')![0]).toEqual(['b2', 'Todo'])
  })

  it('emits statusChange when dropdown changed', async () => {
    const card = makeCard({ block_id: 'b3', properties: { status: 'Doing' } })
    const wrapper = mount(TableView, {
      props: { cards: [card], groups: noGroups, grouped: false, sort: noSort },
    })
    const select = wrapper.find('select')
    await select.setValue('Canceled')
    expect(wrapper.emitted('statusChange')![0]).toEqual(['b3', 'Canceled'])
  })

  // ── Grouped rendering ──
  it('renders group headers when grouped', () => {
    const groups: Group<BlockCard>[] = [
      { key: 'Todo', label: '待办', items: [makeCard({ block_id: 'b1', properties: { status: 'Todo' } })] },
      { key: 'Done', label: '已完成', items: [makeCard({ block_id: 'b2', properties: { status: 'Done' } })] },
    ]
    const wrapper = mount(TableView, {
      props: { cards: groups.flatMap(g => g.items), groups, grouped: true, sort: noSort },
    })
    const headers = wrapper.findAll('.group-header')
    expect(headers).toHaveLength(2)
    expect(headers[0].text()).toContain('待办')
    expect(headers[1].text()).toContain('已完成')
  })
})
