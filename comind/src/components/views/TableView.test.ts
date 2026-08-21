import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TableView from './TableView.vue'
import type { TableColumnConfig, TableConfig } from '../../core/view'
import type { BlockCard } from '../../wasm/types'
import type { FieldDescriptor, Group, SortRule } from '../../core/query'
import { createRegistry } from '../../core/query'
import { BLOCK_DEFAULT_TABLE_CONFIG } from '../../composables/useBlockQueryRegistry'
import { PAGE_DEFAULT_TABLE_CONFIG, PAGE_ENTITY, registerPageBuiltinFields } from '../../composables/usePageQueryRegistry'
import type { Page } from '../../types/page'

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

// 实体无关字段描述符（仿 Block 注册表，验证 TableView 不依赖 Task）
function makeFields(): FieldDescriptor[] {
  return [
    { key: 'done', label: '完成', type: 'boolean', get: (i) => (i as BlockCard).properties?.['status'] === 'Done' },
    { key: 'content', label: '内容', type: 'text', get: (i) => (i as BlockCard).content_preview },
    {
      key: 'status', label: '状态', type: 'select',
      options: [
        { id: 'Todo', label: '待办' }, { id: 'Doing', label: '进行中' },
        { id: 'Done', label: '已完成' }, { id: 'Canceled', label: '已取消' },
      ],
      get: (i) => (i as BlockCard).properties?.['status'],
    },
    {
      key: 'priority', label: '优先级', type: 'select',
      options: [
        { id: 'Low', label: '低', color: '#9CA3AF' }, { id: 'Medium', label: '中', color: '#3B82F6' },
        { id: 'High', label: '高', color: '#F59E0B' }, { id: 'Urgent', label: '急', color: '#DC2626' },
      ],
      get: (i) => (i as BlockCard).properties?.['priority'],
    },
    { key: 'project', label: '项目', type: 'text', get: (i) => (i as BlockCard).properties?.['project'] },
    {
      key: 'deadline', label: '截止', type: 'date',
      // 与注册表一致：无 deadline 时回退 schedule（D1 修复后）
      get: (i) => {
        const refs = (i as BlockCard).date_refs ?? []
        return refs.find((d) => d.kind === 'deadline')?.date_day
          ?? refs.find((d) => d.kind === 'schedule')?.date_day
      },
    },
    { key: 'page', label: '页面', type: 'text', get: (i) => (i as BlockCard).page_id },
  ]
}

const noSort: SortRule[] = []
const noGroups: Group<BlockCard>[] = []
const config: TableConfig = BLOCK_DEFAULT_TABLE_CONFIG
const fields = makeFields()

function mountTable(props: Record<string, unknown> = {}, attach = false) {
  return mount(TableView, {
    props: {
      items: [makeCard()],
      fields,
      groups: noGroups,
      grouped: false,
      sort: noSort,
      config,
      idKey: 'block_id',
      ...props,
    },
    attachTo: attach ? document.body : undefined,
  })
}

// select 菜单 teleport 到 body，测试后清理，避免残留影响其他用例
afterEach(() => {
  document.body.querySelectorAll('[data-testid="select-menu"]').forEach((n) => n.remove())
})

describe('TableView (generic, field-driven)', () => {
  // ── Empty state ──
  it('renders empty state when no items', () => {
    const wrapper = mountTable({ items: [] })
    expect(wrapper.text()).toContain('没有数据')
    expect(wrapper.find('table').exists()).toBe(false)
  })

  // ── Header columns driven by fields + config roles ──
  it('renders header from field labels', () => {
    const wrapper = mountTable()
    const headers = wrapper.findAll('th').map((th) => th.text().trim())
    expect(headers.some((h) => h.includes('内容'))).toBe(true)
    expect(headers.some((h) => h.includes('状态'))).toBe(true)
    expect(headers.some((h) => h.includes('优先级'))).toBe(true)
    expect(headers.some((h) => h.includes('项目'))).toBe(true)
    expect(headers.some((h) => h.includes('截止'))).toBe(true)
    expect(headers.some((h) => h.includes('页面'))).toBe(true)
  })

  // ── Sort icon ──
  it('shows asc icon for priority sort', () => {
    const wrapper = mountTable({ sort: [{ field: 'priority', dir: 'asc' }] })
    expect(wrapper.find('thead').text()).toContain('↑')
  })

  it('shows desc icon for content sort', () => {
    const wrapper = mountTable({ sort: [{ field: 'content', dir: 'desc' }] })
    expect(wrapper.find('thead').text()).toContain('↓')
  })

  // ── Content (primary) ──
  it('renders content preview', () => {
    const wrapper = mountTable({ items: [makeCard({ content_preview: 'Buy groceries' })] })
    expect(wrapper.text()).toContain('Buy groceries')
  })

  // ── Done row style (role 'done' drives is-done) ──
  it('applies is-done style when done field true', () => {
    const wrapper = mountTable({ items: [makeCard({ properties: { status: 'Done' } })] })
    expect(wrapper.find('.is-done').exists()).toBe(true)
  })

  // ── Status select（BasePopover 菜单，点击触发后 teleport 到 body） ──
  it('opens select menu with all options when triggered', async () => {
    const wrapper = mountTable({ items: [makeCard({ properties: { status: 'Doing' } })] }, true)
    await wrapper.find('.cell-select').trigger('click')
    const menu = document.body.querySelector('[data-testid="select-menu"]')
    expect(menu).not.toBeNull()
    const labels = Array.from(menu!.querySelectorAll('.select-option')).map((el) => el.textContent?.trim())
    expect(labels).toContain('待办')
    expect(labels).toContain('进行中')
    expect(labels).toContain('已完成')
    expect(labels).toContain('已取消')
  })

  // ── Priority colored dot (Option.color lifted to metadata) ──
  it('renders color dot for prioritized item', () => {
    const wrapper = mountTable({ items: [makeCard({ properties: { priority: 'High' } })] })
    expect(wrapper.find('.color-dot').exists()).toBe(true)
  })

  // ── Project ──
  it('renders project name', () => {
    const wrapper = mountTable({ items: [makeCard({ properties: { project: 'comind' } })] })
    expect(wrapper.text()).toContain('comind')
  })

  // ── Deadline (role overdue-date) ──
  it('renders future deadline without overdue class', () => {
    const future = new Date()
    future.setDate(future.getDate() + 5)
    const d = future.toISOString().slice(0, 10)
    const wrapper = mountTable({
      items: [makeCard({ date_refs: [{ kind: 'deadline', iso: d, date_day: d, recurrence: 'none', event_ts: 0 }] })],
    })
    expect(wrapper.find('.cell-deadline').exists()).toBe(true)
    expect(wrapper.find('.cell-deadline.overdue').exists()).toBe(false)
  })

  it('renders overdue deadline with red class', () => {
    const wrapper = mountTable({
      items: [makeCard({ date_refs: [{ kind: 'deadline', iso: '2020-01-01', date_day: '2020-01-01', recurrence: 'none', event_ts: 0 }] })],
    })
    expect(wrapper.find('.cell-deadline.overdue').exists()).toBe(true)
  })

  it('renders no deadline cell when no date_refs', () => {
    const wrapper = mountTable({ items: [makeCard({ date_refs: [] })] })
    expect(wrapper.find('.cell-deadline').exists()).toBe(false)
  })

  // ── D1 回归：仅含 schedule 日期的卡片，截止列仍应显示（不空白） ──
  it('renders deadline cell from schedule-only date_ref (D1 fix)', () => {
    const wrapper = mountTable({
      items: [makeCard({ date_refs: [{ kind: 'schedule', iso: '2026-09-01', date_day: '2026-09-01', recurrence: 'none', event_ts: 0 }] })],
    })
    expect(wrapper.find('.cell-deadline').exists()).toBe(true)
  })

  // ── Link column (role link) ──
  it('renders link button for page column', () => {
    const wrapper = mountTable()
    expect(wrapper.find('.link-btn').exists()).toBe(true)
  })

  // ── Emits ──
  it('emits navigate when row clicked', async () => {
    const wrapper = mountTable({ items: [makeCard({ block_id: 'b1' })] })
    await wrapper.find('.data-row').trigger('click')
    expect(wrapper.emitted('navigate')).toBeTruthy()
    expect(wrapper.emitted('navigate')![0]).toEqual(['b1'])
  })

  it('emits cellChange(done) when checkbox toggled', async () => {
    const wrapper = mountTable({ items: [makeCard({ block_id: 'b1', properties: { status: 'Todo' } })] })
    await wrapper.find('.bool-check').setValue(true)
    expect(wrapper.emitted('cellChange')![0]).toEqual(['b1', 'done', true])
  })

  it('emits cellChange(status) when select option picked', async () => {
    const wrapper = mountTable({ items: [makeCard({ block_id: 'b3', properties: { status: 'Doing' } })] }, true)
    await wrapper.find('.cell-select').trigger('click')
    const menu = document.body.querySelector('[data-testid="select-menu"]') as HTMLElement
    const option = Array.from(menu.querySelectorAll('.select-option')).find(
      (el) => el.textContent?.includes('已取消'),
    ) as HTMLElement
    option.click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('cellChange')![0]).toEqual(['b3', 'status', 'Canceled'])
  })

  // ── Grouped rendering ──
  it('renders group headers when grouped', () => {
    const groups: Group<BlockCard>[] = [
      { key: 'Todo', label: '待办', items: [makeCard({ block_id: 'b1', properties: { status: 'Todo' } })] },
      { key: 'Done', label: '已完成', items: [makeCard({ block_id: 'b2', properties: { status: 'Done' } })] },
    ]
    const wrapper = mountTable({ items: groups.flatMap((g) => g.items), groups, grouped: true })
    const headers = wrapper.findAll('.group-header')
    expect(headers).toHaveLength(2)
    expect(headers[0].text()).toContain('待办')
    expect(headers[1].text()).toContain('已完成')
  })

  // ── 列序由 config 决定（验证不写死列） ──
  it('reorders columns per config', () => {
    const reordered: TableConfig = {
      viewKind: 'table', version: 1,
      columns: [{ key: 'project' }, { key: 'content' }] as TableColumnConfig[],
    }
    const wrapper = mountTable({ items: [makeCard()], config: reordered })
    const keys = wrapper.findAll('th').map((th) => th.text().trim())
    expect(keys[0]).toContain('项目')
    expect(keys[1]).toContain('内容')
  })

  // ── D8 安全兜底：无 config 时只渲染 content 列，不渲染全部注册字段 ──
  it('falls back to content-only column when no config', () => {
    const wrapper = mountTable({ config: undefined })
    const headers = wrapper.findAll('th').map((th) => th.text().trim())
    expect(headers).toHaveLength(1)
    expect(headers[0]).toContain('内容')
  })

  // ── ADR-0023 D6 回归：Page 实体用 PAGE_DEFAULT_TABLE_CONFIG 渲染（列 key 全部为已注册字段）。
  //    曾因 store seed 写入 Block 默认列 config（done/status/deadline…）导致 Page 表格全列空值 ──
  it('renders Page rows with PAGE_DEFAULT_TABLE_CONFIG columns', () => {
    const reg = createRegistry()
    registerPageBuiltinFields(reg)
    const pageFields = reg.list(PAGE_ENTITY)
    const page: Page = {
      id: 'p1', blockId: null, title: '测试页面', type: 'normal', icon: null, cover: null,
      aliases: [], filePath: null, childrenCount: 2, wordCount: 123,
      createdAt: 1723000000000, updatedAt: 1723200000000, deleted: false, deletedAt: null,
    }
    const wrapper = mount(TableView, {
      props: {
        items: [page],
        fields: pageFields,
        groups: [],
        grouped: false,
        sort: [],
        config: PAGE_DEFAULT_TABLE_CONFIG,
        idKey: 'id',
      },
    })
    const headers = wrapper.findAll('th').map((th) => th.text().trim())
    expect(headers[0]).toContain('标题')
    expect(wrapper.text()).toContain('测试页面')
    expect(wrapper.text()).toContain('123') // wordCount
    expect(wrapper.text()).toContain('2') // childrenCount
  })
})
