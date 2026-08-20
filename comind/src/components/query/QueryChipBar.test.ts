import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import QueryChipBar from './QueryChipBar.vue'
import type { FieldDescriptor, Registry, ViewQuery } from '../../core/query'

// 弹层子组件各自已有单测；此处用 vi.mock 替掉，避免拖入
// ConditionPopover→ValueEditor→CalendarPopover(WASM) 的繁重依赖图，
// 只聚焦 QueryChipBar 的编排接线（沙箱资源限制下的必要隔离）。
vi.mock('./ConditionPopover.vue', () => ({
  default: {
    name: 'ConditionPopover',
    props: ['field', 'condition', 'fields', 'position'],
    emits: ['update:condition', 'remove', 'advanced', 'close'],
    template: '<div data-testid="stub-cond"></div>',
  },
}))
vi.mock('./FieldSelectMenu.vue', () => ({
  default: {
    name: 'FieldSelectMenu',
    props: ['fields', 'position'],
    emits: ['select', 'advanced', 'close'],
    template: '<div data-testid="stub-field"></div>',
  },
}))
vi.mock('./SortMenu.vue', () => ({
  default: {
    name: 'SortMenu',
    props: ['sort', 'fields'],
    emits: ['update:sort', 'close'],
    template: '<div data-testid="stub-sort"></div>',
  },
}))
vi.mock('./GroupMenu.vue', () => ({
  default: {
    name: 'GroupMenu',
    props: ['groupBy', 'fields', 'position'],
    emits: ['update:groupBy', 'close'],
    template: '<div data-testid="stub-group"></div>',
  },
}))
vi.mock('../common/BasePopover.vue', () => ({
  default: {
    name: 'BasePopover',
    props: ['visible', 'position'],
    emits: ['close'],
    template: '<div data-testid="stub-popover"><slot/></div>',
  },
}))
vi.mock('./FilterBuilder.vue', () => ({
  default: {
    name: 'FilterBuilder',
    props: ['registry', 'entityType', 'modelValue', 'crossRecordSources', 'showSortGroup'],
    emits: ['update:modelValue'],
    template: '<div data-testid="stub-builder"></div>',
  },
}))

const FIELDS: FieldDescriptor[] = [
  { key: 'title', label: '标题', type: 'text', get: () => '' },
  { key: 'type', label: '类型', type: 'select', options: [{ id: 'normal', label: '普通' }], get: () => '' },
  { key: 'createdAt', label: '创建日期', type: 'date', get: () => '' },
]

const FAKE_REGISTRY = {
  list: () => FIELDS,
  get: () => undefined,
  subscribe: () => () => {},
} as unknown as Registry

const INITIAL: ViewQuery = {
  version: 1,
  filter: {
    combinator: 'and',
    children: [{ field: 'title', op: 'contains', value: { kind: 'literal', value: 'x' } }],
  },
  sort: [{ field: 'createdAt', dir: 'desc' }],
  groupBy: 'type',
}

const EMPTY: ViewQuery = {
  version: 1,
  filter: { combinator: 'and', children: [] },
  sort: [],
  groupBy: null,
}

function mountBar(props: Record<string, unknown> = {}) {
  return mount(QueryChipBar, {
    props: { modelValue: INITIAL, fields: FIELDS, registry: FAKE_REGISTRY, entityType: 'page', ...props },
  })
}

describe('QueryChipBar (ADR-0013)', () => {
  it('baseline: only + Filter, no resident AND/OR, no + Sort/+ Group, no advanced button', () => {
    const w = mountBar({ modelValue: EMPTY })
    expect(w.find('[data-testid="bar-add-filter"]').exists()).toBe(true)
    expect(w.find('[data-testid="combinator-toggle"]').exists()).toBe(false)
    expect(w.find('[data-testid="bar-add-sort"]').exists()).toBe(false)
    expect(w.find('[data-testid="bar-add-group"]').exists()).toBe(false)
    expect(w.find('[data-testid="bar-advanced"]').exists()).toBe(false)
    expect(w.find('[data-testid="bar-sort-agg"]').exists()).toBe(false)
    expect(w.find('[data-testid="bar-agg"]').exists()).toBe(false)
  })

  it('flat filter → individual filter chips', () => {
    const w = mountBar()
    expect(w.findAll('[data-testid="bar-filter-chip"]')).toHaveLength(1)
    expect(w.find('[data-testid="bar-agg"]').exists()).toBe(false)
  })

  it('nested-only filter → aggregated chip (no flat chips)', () => {
    const nested: ViewQuery = {
      version: 1,
      filter: { combinator: 'and', children: [{ combinator: 'or', children: [{ field: 'title', op: 'contains' }] }] },
      sort: [],
      groupBy: null,
    }
    const w = mountBar({ modelValue: nested })
    expect(w.find('[data-testid="bar-agg"]').exists()).toBe(true)
    expect(w.find('[data-testid="bar-agg"]').text()).toContain('1 rule')
    expect(w.findAll('[data-testid="bar-filter-chip"]')).toHaveLength(0)
  })

  it('mixed flat + nested → flat chips + aggregated chip coexist (ADR-0013 D2 修订)', () => {
    const mixed: ViewQuery = {
      version: 1,
      filter: {
        combinator: 'and',
        children: [
          { field: 'title', op: 'contains', value: { kind: 'literal', value: 'x' } }, // flat
          { field: 'type', op: 'is', value: { kind: 'literal', value: 'normal' } },   // flat
          { combinator: 'or', children: [{ field: 'createdAt', op: 'before' }] },       // nested
        ],
      },
      sort: [],
      groupBy: null,
    }
    const w = mountBar({ modelValue: mixed })
    expect(w.findAll('[data-testid="bar-filter-chip"]')).toHaveLength(2)
    expect(w.find('[data-testid="bar-agg"]').exists()).toBe(true)
    expect(w.find('[data-testid="bar-agg"]').text()).toContain('1 rule') // only nested counted
  })

  it('nested filter with 2 leaf conditions → plural "N rules"', () => {
    const nested: ViewQuery = {
      version: 1,
      filter: {
        combinator: 'and',
        children: [{ combinator: 'or', children: [{ field: 'title', op: 'contains' }, { field: 'type', op: 'is' }] }],
      },
      sort: [],
      groupBy: null,
    }
    const w = mountBar({ modelValue: nested })
    expect(w.find('[data-testid="bar-agg"]').text()).toContain('2 rules')
  })

  it('sort aggregated into one chip (no per-chip sort, no + Sort)', () => {
    const w = mountBar()
    expect(w.find('[data-testid="bar-sort-agg"]').exists()).toBe(true)
    expect(w.find('[data-testid="bar-sort-agg"]').text()).toContain('1 sorts')
    expect(w.find('[data-testid="bar-sort-chip"]').exists()).toBe(false)
    expect(w.find('[data-testid="bar-add-sort"]').exists()).toBe(false)
  })

  it('group chip appears when groupBy set (shows label), absent when ungrouped; click opens GroupMenu', async () => {
    const w = mountBar({ modelValue: { ...INITIAL, groupBy: 'type' } })
    const chip = w.find('[data-testid="bar-group-chip"]')
    expect(chip.exists()).toBe(true)
    expect(chip.text()).toContain('类型')
    expect(w.find('[data-testid="bar-add-group"]').exists()).toBe(false)
    await chip.trigger('click')
    await w.vm.$nextTick()
    expect(w.find('[data-testid="stub-group"]').exists()).toBe(true)

    const w2 = mountBar({ modelValue: { ...INITIAL, groupBy: null } })
    expect(w2.find('[data-testid="bar-group-chip"]').exists()).toBe(false)
  })

  it('chip order: sorts | group | advanced | flat | +Filter (left to right)', () => {
    const model: ViewQuery = {
      version: 1,
      filter: {
        combinator: 'and',
        children: [
          { field: 'title', op: 'contains', value: { kind: 'literal', value: 'x' } }, // flat
          { combinator: 'or', children: [{ field: 'createdAt', op: 'before' }] }, // nested
        ],
      },
      sort: [{ field: 'createdAt', dir: 'desc' }],
      groupBy: 'type',
    }
    const w = mountBar({ modelValue: model })
    const order = w
      .findAll('[data-testid]')
      .map((el) => el.attributes('data-testid'))
      .filter(
        (t) =>
          t === 'bar-sort-agg' ||
          t === 'bar-group-chip' ||
          t === 'bar-agg' ||
          t === 'bar-filter-chip' ||
          t === 'bar-add-filter',
      )
    expect(order).toEqual(['bar-sort-agg', 'bar-group-chip', 'bar-agg', 'bar-filter-chip', 'bar-add-filter'])
  })

  it('degrades to raw field key when a condition references a missing field', () => {
    const dirty: ViewQuery = {
      version: 1,
      filter: {
        combinator: 'and',
        children: [{ field: 'ghostField', op: 'contains', value: { kind: 'literal', value: 'x' } }],
      },
      sort: [],
      groupBy: null,
    }
    expect(() => mountBar({ modelValue: dirty })).not.toThrow()
    const w = mountBar({ modelValue: dirty })
    expect(w.findAll('[data-testid="bar-filter-chip"]')).toHaveLength(1)
    expect(w.find('[data-testid="bar-filter-chip"]').text()).toContain('ghostField')
  })

  it('+ Filter → select field adds a condition and opens editor', async () => {
    const w = mountBar()
    await w.find('[data-testid="bar-add-filter"]').trigger('click')
    expect(w.find('[data-testid="stub-field"]').exists()).toBe(true)
    await w.findComponent({ name: 'FieldSelectMenu' }).vm.$emit('select', 'createdAt')
    await w.vm.$nextTick()
    const m = w.emitted('update:modelValue')!.at(-1)![0] as ViewQuery
    await w.setProps({ modelValue: m })
    expect(w.findAll('[data-testid="bar-filter-chip"]')).toHaveLength(2)
    expect(w.find('[data-testid="stub-cond"]').exists()).toBe(true)
  })

  it('REGRESSION: 选中字段后显示 chipbar（visible 内聚，无需父级事件）', async () => {
    const w = mountBar()
    expect(w.find('[data-testid="chipbar-wrap"]').classes()).not.toContain('is-open')
    await w.find('[data-testid="bar-add-filter"]').trigger('click')
    await w.findComponent({ name: 'FieldSelectMenu' }).vm.$emit('select', 'createdAt')
    await w.vm.$nextTick()
    expect(w.find('[data-testid="chipbar-wrap"]').classes()).toContain('is-open')
  })

  it('REGRESSION: 空态选中分组字段后显示 chipbar', async () => {
    const w = mountBar({ modelValue: { ...INITIAL, groupBy: null } })
    expect(w.find('[data-testid="chipbar-wrap"]').classes()).not.toContain('is-open')
    ;(w.vm as unknown as { openToolbarMenu: (kind: string, el?: HTMLElement) => void }).openToolbarMenu('group', undefined)
    await w.vm.$nextTick()
    await w.findComponent({ name: 'GroupMenu' }).vm.$emit('update:groupBy', 'type')
    await w.vm.$nextTick()
    expect(w.find('[data-testid="chipbar-wrap"]').classes()).toContain('is-open')
  })

  it('openToolbarMenu sort (no sorts) adds a sort and opens SortMenu', async () => {
    const w = mountBar({ modelValue: { ...INITIAL, sort: [] } })
    ;(w.vm as unknown as { openToolbarMenu: (kind: string, el?: HTMLElement) => void }).openToolbarMenu('sort', undefined)
    await w.vm.$nextTick()
    const m = w.emitted('update:modelValue')!.at(-1)![0] as ViewQuery
    expect(m.sort).toHaveLength(1)
    await w.setProps({ modelValue: m })
    expect(w.find('[data-testid="stub-sort"]').exists()).toBe(true)
  })

  it('openToolbarMenu group opens GroupMenu without mutating modelValue', async () => {
    const w = mountBar({ modelValue: { ...INITIAL, groupBy: null } })
    ;(w.vm as unknown as { openToolbarMenu: (kind: string, el?: HTMLElement) => void }).openToolbarMenu('group', undefined)
    await w.vm.$nextTick()
    expect(w.find('[data-testid="stub-group"]').exists()).toBe(true)
    expect(w.emitted('update:modelValue')).toBeUndefined()
  })

  it('FieldSelectMenu "Add advanced filter" opens advanced popover (no open-advanced emit)', async () => {
    const w = mountBar()
    await w.find('[data-testid="bar-add-filter"]').trigger('click')
    await w.findComponent({ name: 'FieldSelectMenu' }).vm.$emit('advanced')
    await w.vm.$nextTick()
    expect(w.find('[data-testid="stub-popover"]').exists()).toBe(true)
    expect(w.find('[data-testid="stub-builder"]').exists()).toBe(true)
    expect(w.emitted('open-advanced')).toBeUndefined()
  })

  it('aggregated chip click opens advanced popover', async () => {
    const nested: ViewQuery = {
      version: 1,
      filter: { combinator: 'and', children: [{ combinator: 'or', children: [{ field: 'title', op: 'contains' }] }] },
      sort: [],
      groupBy: null,
    }
    const w = mountBar({ modelValue: nested })
    await w.find('[data-testid="bar-agg"]').trigger('click')
    await w.vm.$nextTick()
    expect(w.find('[data-testid="stub-popover"]').exists()).toBe(true)
    expect(w.find('[data-testid="stub-builder"]').exists()).toBe(true)
  })

  it('advanced popover update appends a nested group, keeping flat conditions + sort/groupBy', async () => {
    const w = mountBar()
    await w.find('[data-testid="bar-add-filter"]').trigger('click')
    await w.findComponent({ name: 'FieldSelectMenu' }).vm.$emit('advanced')
    await w.vm.$nextTick()
    const advancedFilter = { combinator: 'or' as const, children: [{ field: 'type', op: 'is', value: { kind: 'literal' as const, value: 'normal' } }] }
    await w.findComponent({ name: 'FilterBuilder' }).vm.$emit('update:modelValue', {
      version: 1,
      filter: advancedFilter,
      sort: [],
      groupBy: null,
    })
    await w.vm.$nextTick()
    const m = w.emitted('update:modelValue')!.at(-1)![0] as ViewQuery
    // 扁平条件保留，嵌套高级组作为子节点追加（不入 panel、不替换整棵）
    expect(m.filter.children).toHaveLength(2)
    expect(m.filter.children[0]).toEqual(INITIAL.filter.children[0])
    expect(m.filter.children[1]).toEqual(advancedFilter)
    expect(m.sort).toEqual(INITIAL.sort)
    expect(m.groupBy).toBe(INITIAL.groupBy)
  })

  it('open aggregate chip → FilterBuilder receives scoped model (nested only, flat excluded)', async () => {
    const mixed: ViewQuery = {
      version: 1,
      filter: {
        combinator: 'and',
        children: [
          { field: 'title', op: 'contains', value: { kind: 'literal', value: 'x' } }, // flat
          { field: 'type', op: 'is', value: { kind: 'literal', value: 'normal' } },   // flat
          { combinator: 'or', children: [{ field: 'createdAt', op: 'before' }] },       // nested
        ],
      },
      sort: [],
      groupBy: null,
    }
    const w = mountBar({ modelValue: mixed })
    await w.find('[data-testid="bar-agg"]').trigger('click')
    await w.vm.$nextTick()
    const builderModel = w.findComponent({ name: 'FilterBuilder' }).props('modelValue') as ViewQuery
    // 面板只拿到嵌套组本身（扁平条件不在 panel 的 filter 里）
    expect(builderModel.filter).toMatchObject({ combinator: 'or' })
    expect(builderModel.filter.children).toHaveLength(1)
    expect(builderModel.filter.children[0]).toMatchObject({ field: 'createdAt' })
  })

  it('advanced panel clears all nested → nested group removed, flat conditions kept', async () => {
    const mixed: ViewQuery = {
      version: 1,
      filter: {
        combinator: 'and',
        children: [
          { field: 'title', op: 'contains', value: { kind: 'literal', value: 'x' } }, // flat
          { combinator: 'or', children: [{ field: 'createdAt', op: 'before' }] },       // nested
        ],
      },
      sort: [],
      groupBy: null,
    }
    const w = mountBar({ modelValue: mixed })
    await w.find('[data-testid="bar-agg"]').trigger('click')
    await w.vm.$nextTick()
    const empty = { version: 1, filter: { combinator: 'and', children: [] }, sort: [], groupBy: null }
    await w.findComponent({ name: 'FilterBuilder' }).vm.$emit('update:modelValue', empty)
    await w.vm.$nextTick()
    const m = w.emitted('update:modelValue')!.at(-1)![0] as ViewQuery
    expect(m.filter.children).toHaveLength(1)
    expect(m.filter.children[0]).toMatchObject({ field: 'title' }) // 仅剩扁平条件
    await w.setProps({ modelValue: m })
    await w.vm.$nextTick()
    expect(w.find('[data-testid="bar-agg"]').exists()).toBe(false)
  })

  it('REGRESSION: flat chip index must be real children index (nested group precedes it)', async () => {
    // 复现 bug：children[0]=嵌套组(聚合 chip)，children[1]=扁平条件
    const mixed: ViewQuery = {
      version: 1,
      filter: {
        combinator: 'and',
        children: [
          { combinator: 'or', children: [{ field: 'title', op: 'isEmpty' }] }, // 聚合 chip
          { field: 'type', op: 'is', value: { kind: 'literal', value: 'normal' } }, // 扁平 chip
        ],
      },
      sort: [],
      groupBy: null,
    }
    const w = mountBar({ modelValue: mixed })
    // 应有聚合 chip + 1 个扁平 chip
    expect(w.find('[data-testid="bar-agg"]').exists()).toBe(true)
    const flatChips = w.findAll('[data-testid="bar-filter-chip"]')
    expect(flatChips).toHaveLength(1)

    // ① 点击扁平 chip → 应弹出 ConditionPopover（修复前：condTarget 指向 children[0] 嵌套组 → 弹不出）
    await flatChips[0].trigger('click')
    await w.vm.$nextTick()
    expect(w.find('[data-testid="stub-cond"]').exists()).toBe(true)

    // ② 点扁平 chip 的 × → 应删 children[1]（扁平条件），聚合 chip 保留（修复前误删 children[0]）
    await flatChips[0].find('[data-testid="chip-remove"]').trigger('click')
    await w.vm.$nextTick()
    const m = w.emitted('update:modelValue')!.at(-1)![0] as ViewQuery
    expect(m.filter.children).toHaveLength(1)
    expect(m.filter.children[0]).toMatchObject({ combinator: 'or' }) // 聚合 chip 仍在
    await w.setProps({ modelValue: m })
    await w.vm.$nextTick()
    expect(w.find('[data-testid="bar-filter-chip"]').exists()).toBe(false)
    expect(w.find('[data-testid="bar-agg"]').exists()).toBe(true)
  })
})
