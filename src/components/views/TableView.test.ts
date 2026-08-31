import { describe, it, expect } from 'vitest'
import { defineComponent, h, markRaw } from 'vue'
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
    created_at: 1723000000000,
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
  document.body.querySelectorAll('[data-testid="col-menu"]').forEach((n) => n.remove())
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

  // ── Header icons (lucide type icons) ──
  it('renders a type icon in each column header (Link2 for link role)', () => {
    const wrapper = mountTable({ items: [makeCard({ block_id: 'b1' })] })
    // 数据列（boolean/text/select/date）表头都有 svg 图标
    for (const key of ['status', 'content', 'priority', 'deadline']) {
      expect(wrapper.find(`thead .col-${key} svg`).exists()).toBe(true)
    }
    // link 角色列（page）也有图标
    expect(wrapper.find('thead .col-page svg').exists()).toBe(true)
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

  // ── select 菜单（BasePopover，点击触发后 teleport 到 body；status 现为图标列，改用 priority 验证） ──
  it('opens select menu with all options when triggered', async () => {
    const wrapper = mountTable({ items: [makeCard({ properties: { priority: 'High' } })] }, true)
    await wrapper.find('tbody .col-priority .cell-select').trigger('click')
    const menu = document.body.querySelector('[data-testid="select-menu"]')
    expect(menu).not.toBeNull()
    const labels = Array.from(menu!.querySelectorAll('.select-option')).map((el) => el.textContent?.trim())
    expect(labels).toContain('低')
    expect(labels).toContain('中')
    expect(labels).toContain('高')
    expect(labels).toContain('急')
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
  it('emits cellClick with field key when title cell clicked', async () => {
    const wrapper = mountTable({ items: [makeCard({ block_id: 'b1' })] })
    await wrapper.find('tbody .col-content').trigger('click')
    expect(wrapper.emitted('cellClick')![0]).toEqual(['b1', 'content'])
  })

  it('emits cellClick with field key for plain cells', async () => {
    const wrapper = mountTable({ items: [makeCard({ block_id: 'b1' })] })
    await wrapper.find('tbody .col-project').trigger('click')
    expect(wrapper.emitted('cellClick')![0]).toEqual(['b1', 'project'])
  })

  it('emits cellClick with field key when link button clicked (bubbles to td)', async () => {
    const wrapper = mountTable({ items: [makeCard({ block_id: 'b1' })] })
    await wrapper.find('.link-btn').trigger('click')
    expect(wrapper.emitted('cellClick')![0]).toEqual(['b1', 'page'])
  })

  it('does not emit cellClick when status icon clicked (cycles instead)', async () => {
    const wrapper = mountTable({ items: [makeCard({ block_id: 'b1', properties: { status: 'Todo' } })] })
    await wrapper.find('tbody .col-status .status-icon-btn').trigger('click')
    expect(wrapper.emitted('cellClick')).toBeFalsy()
  })

  it('cycles status and emits cellChange(status, next) when icon clicked', async () => {
    const wrapper = mountTable({ items: [makeCard({ block_id: 'b1', properties: { status: 'Todo' } })] })
    await wrapper.find('tbody .col-status .status-icon-btn').trigger('click')
    expect(wrapper.emitted('cellChange')![0]).toEqual(['b1', 'status', 'Doing'])
  })

  // select 菜单现由整个 cell 点击触发（td @click → onCellMaybeOpenSelect）。
  // status 现为首列图标列（点击循环），改用 priority 验证「点 td 任意处弹菜单」行为。
  it('opens select menu when clicking anywhere on the td, then emits cellChange on pick', async () => {
    const wrapper = mountTable({ items: [makeCard({ block_id: 'b3', properties: { priority: 'Medium' } })] }, true)
    // 点 cell 任意位置（这里点 td 上 padding 区域，不是 .cell-select span 内）
    await wrapper.find('tbody .col-priority').trigger('click')
    const menu = document.body.querySelector('[data-testid="select-menu"]') as HTMLElement
    expect(menu).toBeTruthy()
    const option = Array.from(menu.querySelectorAll('.select-option')).find(
      (el) => el.textContent?.includes('急'),
    ) as HTMLElement
    option.click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('cellChange')![0]).toEqual(['b3', 'priority', 'Urgent'])
  })

  // status 首列为图标列（.status-icon-btn），不再渲染 .cell-select；其余 select 列（priority）行为不变。
  it('renders status icon in the status column and ChevronDown in select cells', () => {
    const wrapper = mountTable({ items: [makeCard({ block_id: 'b1' })] })
    // status 图标列：渲染图标按钮，不渲染 select 容器/chevron
    expect(wrapper.find('tbody .col-status .status-icon-btn').exists()).toBe(true)
    expect(wrapper.find('tbody .col-status .cell-select').exists()).toBe(false)
    expect(wrapper.find('tbody .col-status .cell-select-chevron').exists()).toBe(false)
    // 空态 select 列（priority）：.empty 类 + chevron 存在，无 label
    expect(wrapper.find('tbody .col-priority .cell-select.empty').exists()).toBe(true)
    expect(wrapper.find('tbody .col-priority .cell-select-chevron').exists()).toBe(true)
    expect(wrapper.find('tbody .col-priority .cell-select-label').exists()).toBe(false)
    // 有值 select 列：无 .empty 类、label 显示选项，chevron 仍在 DOM（hover/open 时显示）
    const set = mountTable({ items: [makeCard({ block_id: 'b2', properties: { priority: 'High' } })] })
    expect(set.find('tbody .col-priority .cell-select.empty').exists()).toBe(false)
    expect(set.find('tbody .col-priority .cell-select-chevron').exists()).toBe(true)
    expect(set.find('tbody .col-priority .cell-select-label').text()).toBe('高')
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

  // ── 渲染层分页（ADR-0024） ──

  // 造 N 条卡片（内容唯一便于断言当前页切片）
  function makeMany(n: number): BlockCard[] {
    return Array.from({ length: n }, (_, i) => makeCard({ block_id: `block-${i}`, content_preview: `Task ${i}` }))
  }

  it('slices large list to first page by default page size (50)', () => {
    const wrapper = mountTable({ items: makeMany(160) })
    expect(wrapper.findAll('.data-row')).toHaveLength(50)
    expect(wrapper.text()).toContain('Task 0')
    expect(wrapper.text()).not.toContain('Task 50')
    expect(wrapper.text()).toContain('共 160 条')
    expect(wrapper.text()).toContain('第 1/4 页')
  })

  it('does not show pagination bar when under page size', () => {
    const wrapper = mountTable({ items: makeMany(20) })
    expect(wrapper.find('[data-testid="pagination-bar"]').exists()).toBe(false)
  })

  it('renders full list when pagination disabled (pageSize <= 0)', () => {
    const wrapper = mountTable({ items: makeMany(120), pageSize: 0 })
    expect(wrapper.findAll('.data-row')).toHaveLength(120)
    expect(wrapper.find('[data-testid="pagination-bar"]').exists()).toBe(false)
  })

  it('navigates pages with prev/next and clamps at bounds', async () => {
    const wrapper = mountTable({ items: makeMany(120) })
    const next = wrapper.find('[data-testid="page-next"]')
    const prev = wrapper.find('[data-testid="page-prev"]')
    expect(prev.attributes('disabled')).toBeDefined()

    await next.trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('第 2/3 页')
    expect(wrapper.text()).toContain('Task 50')
    expect(wrapper.text()).not.toContain('Task 0')

    // 翻到末页后 next 禁用
    await next.trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('第 3/3 页')
    expect(next.attributes('disabled')).toBeDefined()

    // prev 回到第 2 页
    await prev.trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('第 2/3 页')
  })

  it('respects custom pageSize prop', () => {
    const wrapper = mountTable({ items: makeMany(100), pageSize: 20 })
    expect(wrapper.findAll('.data-row')).toHaveLength(20)
    expect(wrapper.text()).toContain('第 1/5 页')
  })

  it('changes page size via dropdown and clamps current page', async () => {
    const wrapper = mountTable({ items: makeMany(100) }) // 默认 50 → 2 页
    await wrapper.find('[data-testid="page-next"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('第 2/2 页')
    // 切到 100 条/页 → 单页，clamp 回第 1 页
    await wrapper.find('[data-testid="page-size-select"]').setValue('100')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('第 1/1 页')
    expect(wrapper.findAll('.data-row')).toHaveLength(100)
  })

  it('resets to first page when sort changes', async () => {
    const wrapper = mountTable({ items: makeMany(120) })
    await wrapper.find('[data-testid="page-next"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('第 2/3 页')
    await wrapper.setProps({ sort: [{ field: 'priority', dir: 'desc' }] })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('第 1/3 页')
  })

  it('resets to first page when items shrink (query change, ADR-0024 D3)', async () => {
    const wrapper = mountTable({ items: makeMany(120) }) // 3 页
    await wrapper.find('[data-testid="page-next"]').trigger('click')
    await wrapper.find('[data-testid="page-next"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('第 3/3 页')
    // 筛选/搜索导致结果集缩小（items 长度变化）→ 回第 1 页
    await wrapper.setProps({ items: makeMany(60) })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('第 1/2 页')
    expect(wrapper.text()).toContain('Task 0')
  })

  it('paginates across groups by flat record sequence (ADR-0024 D2)', () => {
    // 两组：A 组 30 条 + B 组 30 条，pageSize 20 → 第 2 页跨组
    const groupA: Group<BlockCard> = { key: 'A', label: 'A 组', items: makeMany(30).map((c) => ({ ...c, block_id: `a-${c.block_id}` })) }
    const groupB: Group<BlockCard> = { key: 'B', label: 'B 组', items: makeMany(30).map((c) => ({ ...c, block_id: `b-${c.block_id}` })) }
    const wrapper = mount(TableView, {
      props: {
        items: makeMany(60),
        fields,
        groups: [groupA, groupB],
        grouped: true,
        sort: noSort,
        config,
        idKey: 'block_id',
        pageSize: 20,
      },
    })
    // 第 1 页：A 组前 20 条（组头显示全量 30）
    expect(wrapper.findAll('.data-row')).toHaveLength(20)
    expect(wrapper.text()).toContain('A 组')
    expect(wrapper.text()).not.toContain('B 组')
    // 翻到第 2 页：A 组余 10 条 + B 组前 10 条（跨组连续）
    const next = wrapper.find('[data-testid="page-next"]')
    return next.trigger('click').then(() => {
      expect(wrapper.text()).toContain('A 组')
      expect(wrapper.text()).toContain('B 组')
      expect(wrapper.findAll('.data-row')).toHaveLength(20)
      expect(wrapper.text()).toContain('共 60 条')
    })
  })

  // ── Field interaction configurability (FieldDescriptor.editable) ──
  it('renders select as read-only when editable=false and does not open menu', async () => {
    const readonlyFields: FieldDescriptor[] = [
      ...fields,
      {
        key: 'stage', label: '阶段', type: 'select',
        options: [{ id: 'A', label: 'A阶段' }, { id: 'B', label: 'B阶段' }],
        editable: false,
        get: () => 'A',
      },
    ]
    const cfg: TableConfig = { viewKind: 'table', version: 1, columns: [...config.columns, { key: 'stage' }] }
    const wrapper = mountTable({ fields: readonlyFields, config: cfg, items: [makeCard({ block_id: 'b1' })] })
    // stage 列渲染为 .cell-select.readonly（无 .cell-select-readonly 单独类）
    const stageTd = wrapper.find('tbody .col-stage')
    expect(stageTd.find('.cell-select').exists()).toBe(true)
    expect(stageTd.find('.cell-select.readonly').exists()).toBe(true)
    expect(stageTd.find('.cell-select-readonly').exists()).toBe(false)
    expect(stageTd.text()).toContain('A阶段')
    // 点击只读 cell 不弹下拉菜单（业务方仍可通过 cellClick 事件处理跳转/预览）
    await stageTd.trigger('click')
    expect(document.body.querySelector('[data-testid="select-menu"]')).toBeFalsy()
    expect(wrapper.emitted('cellClick')![0]).toEqual(['b1', 'stage'])
  })

  it('renders boolean as read-only check when editable=false', () => {
    const readonlyFields: FieldDescriptor[] = [
      ...fields,
      { key: 'flag', label: '标记', type: 'boolean', editable: false, get: () => true },
    ]
    const cfg: TableConfig = { viewKind: 'table', version: 1, columns: [...config.columns, { key: 'flag' }] }
    const wrapper = mountTable({ fields: readonlyFields, config: cfg, items: [makeCard({ block_id: 'b1' })] })
    const flagTd = wrapper.find('tbody .col-flag')
    expect(flagTd.find('.bool-check').exists()).toBe(false)
    expect(flagTd.find('.cell-bool-readonly').text()).toContain('✓')
  })

  it('keeps select editable by default (editable undefined)', () => {
    // 现有 status/priority 字段未声明 editable → 仍渲染可编辑下拉按钮（向后兼容）
    const wrapper = mountTable({ items: [makeCard({ block_id: 'b1' })] })
    expect(wrapper.find('tbody .cell-select').exists()).toBe(true)
  })
})

describe('TableView custom cell (ADR-0010)', () => {
  // 桩组件：渲染 value + data-testid，纯展示
  const StubCell = markRaw(defineComponent({
    props: ['item', 'value', 'field', 'col', 'editable'],
    setup(props) {
      return () => h('span', { 'data-testid': 'custom-cell' }, String(props.value))
    },
  }))
  // 桩组件：内部按钮 emit change('X')
  const StubCellEmit = markRaw(defineComponent({
    props: ['item', 'value', 'field', 'col', 'editable'],
    emits: ['change'],
    setup(_, { emit }) {
      return () => h('button', { 'data-testid': 'custom-emit', onClick: () => emit('change', 'X') }, 'emit')
    },
  }))
  // 桩组件：内部按钮 @click.stop 阻止冒泡（不 emit change）
  const StubCellStop = markRaw(defineComponent({
    props: ['item', 'value', 'field', 'col', 'editable'],
    setup() {
      return () => h('button', { 'data-testid': 'custom-stop', onClick: (e: Event) => e.stopPropagation() }, 'stop')
    },
  }))

  it('renders registered custom cell when column has cell key', () => {
    const wrapper = mountTable({
      items: [makeCard({ block_id: 'b1', content_preview: 'Custom!' })],
      cellRegistry: { 'block-content': StubCell },
    })
    expect(wrapper.find('[data-testid="custom-cell"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="custom-cell"]').text()).toBe('Custom!')
  })

  it('forwards custom cell change to cellChange with id/key/value', async () => {
    const wrapper = mountTable({
      items: [makeCard({ block_id: 'b1' })],
      cellRegistry: { 'block-content': StubCellEmit },
    })
    await wrapper.find('[data-testid="custom-emit"]').trigger('click')
    expect(wrapper.emitted('cellChange')![0]).toEqual(['b1', 'content', 'X'])
  })

  it('falls back to default rendering when cell key not in registry', () => {
    const wrapper = mountTable({
      items: [makeCard({ block_id: 'b1', content_preview: 'Fallback' })],
      cellRegistry: {},
    })
    expect(wrapper.find('[data-testid="custom-cell"]').exists()).toBe(false)
    expect(wrapper.find('tbody .col-content .cell-primary').exists()).toBe(true)
    expect(wrapper.text()).toContain('Fallback')
  })

  it('does not emit cellClick when internal interactive element stops propagation', async () => {
    const wrapper = mountTable({
      items: [makeCard({ block_id: 'b1' })],
      cellRegistry: { 'block-content': StubCellStop },
    })
    await wrapper.find('[data-testid="custom-stop"]').trigger('click')
    expect(wrapper.emitted('cellClick')).toBeFalsy()
  })

  it('emits cellClick when clicking custom cell surface (outside stopped element)', async () => {
    const wrapper = mountTable({
      items: [makeCard({ block_id: 'b1' })],
      cellRegistry: { 'block-content': StubCell },
    })
    await wrapper.find('tbody .col-content').trigger('click')
    expect(wrapper.emitted('cellClick')![0]).toEqual(['b1', 'content'])
  })
})

describe('TableView column resize (ADR-0013)', () => {
  function linkKeysOf(): string[] {
    return config.columns.filter((c) => c.role === 'link').map((c) => c.key)
  }

  // 手柄只渲染在「两列之间」的分隔线上：非 link、非最末列才有；link 列与末列右缘（即表格右缘）无
  it('renders a resize handle on every non-link column header except the last', () => {
    const wrapper = mountTable({ items: [makeCard({ block_id: 'b1' })] })
    const linkKeys = linkKeysOf()
    const lastKey = config.columns.filter((c) => c.visible !== false).slice(-1)[0]?.key
    for (const th of wrapper.findAll('th')) {
      const key = th.classes().find((c) => c.startsWith('col-'))!.slice(4)
      const expectHandle = !linkKeys.includes(key) && key !== lastKey
      expect(th.find('[data-testid="col-resizer"]').exists()).toBe(expectHandle)
    }
  })

  // link 列无手柄；每列都渲染像素宽（jsdom 无布局：容器宽 0 → 全列退化为 40px 下限）
  it('omits the resize handle on link columns and renders a pixel width', () => {
    const wrapper = mountTable({ items: [makeCard({ block_id: 'b1' })] })
    const linkKeys = linkKeysOf()
    expect(linkKeys.length).toBeGreaterThan(0)
    for (const key of linkKeys) {
      const th = wrapper.find(`thead .col-${key}`)
      expect(th.exists()).toBe(true)
      expect(th.find('[data-testid="col-resizer"]').exists()).toBe(false)
      expect(th.attributes('style')).toMatch(/\d+px/)
    }
  })

  // ── 比例模式（ADR-0013）──
  // jsdom 无布局（容器宽 0）→ 退化为各列下限 40px；权重分配逻辑由 tableWidths.test.ts 单测。
  it('renders a pixel width on every column header', () => {
    const wrapper = mountTable({ items: [makeCard({ block_id: 'b1' })] })
    for (const th of wrapper.findAll('thead th')) {
      expect(th.attributes('style')).toMatch(/\d+px/)
    }
  })

  // 边界联动（ADR-0013）：用显式宽度的 config 保证 jsdom 下起点宽确定（jsdom getBoundingClientRect 为 0）。
  const resizeConfig: TableConfig = {
    viewKind: 'table',
    version: 1,
    columns: [
      { key: 'content', width: 100 },
      { key: 'status', width: 100 },
      { key: 'priority', width: 100 },
    ],
  }

  // 拖宽本列：content 期望 +100→200，但下一列 status 有 60px 下限（MIN_COL_WIDTH）→ content 封顶 140、status 60
  it('emits linked widths for both columns when dragging wider', async () => {
    const wrapper = mountTable({ items: [makeCard({ block_id: 'b1' })], config: resizeConfig })
    const resizer = wrapper.find('thead .col-content [data-testid="col-resizer"]')
    expect(resizer.exists()).toBe(true)
    resizer.element.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, bubbles: true }))
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 200 }))
    void window.dispatchEvent(new MouseEvent('pointerup', { clientX: 200 }))
    expect(wrapper.emitted('columnResize')).toBeTruthy()
    expect(wrapper.emitted('columnResize')![0][0]).toEqual([
      { key: 'content', width: 140 },
      { key: 'status', width: 60 },
    ])
  })

  // 拖窄本列到下限：content 夹到 60px（MIN_COL_WIDTH），差额 -40 推给下一列 status → 140（总宽恒定 200）
  it('clamps the dragged column to 60px and pushes the delta onto the next column', async () => {
    const wrapper = mountTable({ items: [makeCard({ block_id: 'b1' })], config: resizeConfig })
    const resizer = wrapper.find('thead .col-content [data-testid="col-resizer"]')
    resizer.element.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, bubbles: true }))
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 20 })) // delta -80
    void window.dispatchEvent(new MouseEvent('pointerup', { clientX: 20 }))
    expect(wrapper.emitted('columnResize')![0][0]).toEqual([
      { key: 'content', width: 60 },
      { key: 'status', width: 140 },
    ])
  })

  // 末列无独立手柄（其右缘即表格右缘、无下一列可联动）；通过它左侧的分隔线（status 手柄）联动改变：
  // status +100 受「priority ≥ 60」（MIN_COL_WIDTH）约束封顶到 140，priority 60（总宽恒定 200）
  it('resizes the last column via the divider to its left', async () => {
    const wrapper = mountTable({ items: [makeCard({ block_id: 'b1' })], config: resizeConfig })
    expect(wrapper.find('thead .col-priority [data-testid="col-resizer"]').exists()).toBe(false)
    const resizer = wrapper.find('thead .col-status [data-testid="col-resizer"]')
    expect(resizer.exists()).toBe(true)
    resizer.element.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, bubbles: true }))
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 200 }))
    void window.dispatchEvent(new MouseEvent('pointerup', { clientX: 200 }))
    expect(wrapper.emitted('columnResize')![0][0]).toEqual([
      { key: 'status', width: 140 },
      { key: 'priority', width: 60 },
    ])
  })

  // link 末列作为 next 参与联动（用户场景：拖"截止"右缘 → "页面(link)"列变宽）。
  // status 起始 100、page(link) 起始 40（link 默认宽，非下限）；拖 status −60 → status 夹到 60（MIN_COL_WIDTH），
  // 差额 -40 推给 page 40+40=80。
  it('links the trailing link column as the resize partner (its width changes)', async () => {
    const linkCfg: TableConfig = {
      viewKind: 'table',
      version: 1,
      columns: [
        { key: 'content', width: 100 },
        { key: 'status', width: 100 },
        { key: 'page', role: 'link' },
      ],
    }
    const wrapper = mountTable({ items: [makeCard({ block_id: 'b1' })], config: linkCfg })
    // page 是末列 + link → 无手柄
    expect(wrapper.find('thead .col-page [data-testid="col-resizer"]').exists()).toBe(false)
    const resizer = wrapper.find('thead .col-status [data-testid="col-resizer"]')
    expect(resizer.exists()).toBe(true)
    resizer.element.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, bubbles: true }))
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 40 })) // -60
    void window.dispatchEvent(new MouseEvent('pointerup', { clientX: 40 }))
    expect(wrapper.emitted('columnResize')![0][0]).toEqual([
      { key: 'status', width: 60 },
      { key: 'page', width: 80 },
    ])
  })

  // ── 表头菜单（列对齐 / 隐藏字段 / 重置列宽）──
  it('opens a column menu on header title click', async () => {
    const wrapper = mountTable({ items: [makeCard({ block_id: 'b1' })] })
    await wrapper.find('thead .col-content .th-label').trigger('click')
    const menu = document.body.querySelector('[data-testid="col-menu"]')
    expect(menu).toBeTruthy()
    expect(menu!.textContent).toContain('对齐方式')
    expect(menu!.textContent).toContain('隐藏此字段')
    expect(menu!.textContent).toContain('重置列宽')
    // 未显式设置对齐时默认左激活（数据单元格默认左对齐）
    expect(menu!.querySelector('.col-menu-align-btn.active')?.textContent).toBe('左')
  })

  it('emits columnAlign when picking an alignment', async () => {
    const wrapper = mountTable({ items: [makeCard({ block_id: 'b1' })] })
    await wrapper.find('thead .col-content .th-label').trigger('click')
    const menu = document.body.querySelector('[data-testid="col-menu"]') as HTMLElement
    const btn = Array.from(menu.querySelectorAll('.col-menu-align-btn')).find(
      (b) => b.textContent === '中',
    ) as HTMLElement
    btn.click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('columnAlign')![0]).toEqual(['content', 'center'])
  })

  it('emits columnVisibility(false) when hiding a field', async () => {
    const wrapper = mountTable({ items: [makeCard({ block_id: 'b1' })] })
    await wrapper.find('thead .col-content .th-label').trigger('click')
    const menu = document.body.querySelector('[data-testid="col-menu"]') as HTMLElement
    const item = Array.from(menu.querySelectorAll('.col-menu-item')).find(
      (b) => b.textContent === '隐藏此字段',
    ) as HTMLElement
    item.click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('columnVisibility')![0]).toEqual(['content', false])
  })

  it('emits columnReset when resetting width', async () => {
    const wrapper = mountTable({ items: [makeCard({ block_id: 'b1' })] })
    await wrapper.find('thead .col-content .th-label').trigger('click')
    const menu = document.body.querySelector('[data-testid="col-menu"]') as HTMLElement
    const item = Array.from(menu.querySelectorAll('.col-menu-item')).find(
      (b) => b.textContent === '重置列宽',
    ) as HTMLElement
    item.click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('columnReset')![0]).toEqual(['content'])
  })

  // 对齐渲染：config 显式 align → th/td 内联 text-align；未设置列保持默认（无内联覆盖）
  it('renders column align on th and td when set', () => {
    const alignCfg: TableConfig = {
      viewKind: 'table',
      version: 1,
      columns: [
        { key: 'content', align: 'center' },
        { key: 'status' },
      ],
    }
    const wrapper = mountTable({ items: [makeCard({ block_id: 'b1' })], config: alignCfg })
    expect(wrapper.find('thead .col-content').attributes('style')).toContain('text-align: center')
    expect(wrapper.find('tbody .col-content').attributes('style')).toContain('text-align: center')
    expect(wrapper.find('thead .col-status').attributes('style')).not.toContain('text-align')
    expect(wrapper.find('tbody .col-status').attributes('style')).not.toContain('text-align')
  })

  // select 单元格对齐修复回归：td 的 text-align 对 flex 容器无效，
  // 故须给 td 加 align-* 类驱动 .cell-select 的 justify-content。
  it('adds align class to select cell td so flex content can honor alignment', () => {
    const selectAlignCfg: TableConfig = {
      viewKind: 'table',
      version: 1,
      columns: [
        { key: 'status', align: 'center' },
        { key: 'priority', align: 'right' },
      ],
    }
    const wrapper = mountTable({
      items: [makeCard({ block_id: 'b1', properties: { status: 'Doing', priority: 'High' } })],
      config: selectAlignCfg,
    })
    const statusTd = wrapper.find('tbody .col-status')
    const priorityTd = wrapper.find('tbody .col-priority')
    // 对齐类落到 td，select 容器据此设 justify-content（CSS 修复核心）
    expect(statusTd.classes()).toContain('align-center')
    expect(priorityTd.classes()).toContain('align-right')
    // select 容器仍存在且未被破坏
    expect(statusTd.find('.cell-select').exists()).toBe(true)
    expect(priorityTd.find('.cell-select').exists()).toBe(true)
  })

  it('defaults select cell td to align-left class when no align set', () => {
    const wrapper = mountTable({ items: [makeCard({ block_id: 'b1' })] })
    const statusTd = wrapper.find('tbody .col-status')
    const priorityTd = wrapper.find('tbody .col-priority')
    expect(statusTd.classes()).toContain('align-left')
    expect(priorityTd.classes()).toContain('align-left')
    // status 现为图标列（无 .cell-select），select 列（priority）仍渲染 .cell-select
    expect(priorityTd.find('.cell-select').exists()).toBe(true)
  })
})
