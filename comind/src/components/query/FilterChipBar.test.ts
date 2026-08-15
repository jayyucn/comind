import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import FilterChipBar from './FilterChipBar.vue'
import type { FieldDescriptor, ViewQuery } from '../../core/query'

// 弹层子组件各自已有单测；此处用 vi.mock 替掉，避免拖入
// ConditionPopover→ChipValueEditor→CalendarPopover(WASM) 的繁重依赖图，
// 只聚焦 FilterChipBar 的编排接线（沙箱资源限制下的必要隔离）。
vi.mock('./ConditionPopover.vue', () => ({
  default: {
    name: 'ConditionPopover',
    props: ['field', 'condition', 'fields', 'position'],
    emits: ['update:condition', 'remove', 'close'],
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
    props: ['rule', 'fields', 'position'],
    emits: ['update:rule', 'add', 'remove', 'close'],
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

const FIELDS: FieldDescriptor[] = [
  { key: 'title', label: '标题', type: 'text', get: () => '' },
  { key: 'type', label: '类型', type: 'select', options: [{ id: 'normal', label: '普通' }], get: () => '' },
  { key: 'createdAt', label: '创建日期', type: 'date', get: () => '' },
]

const INITIAL: ViewQuery = {
  version: 1,
  filter: {
    combinator: 'and',
    children: [{ field: 'title', op: 'contains', value: { kind: 'literal', value: 'x' } }],
  },
  sort: [{ field: 'createdAt', dir: 'desc' }],
  groupBy: 'type',
}

function mountBar(props = {}) {
  return mount(FilterChipBar, {
    props: { modelValue: INITIAL, fields: FIELDS, ...props },
  })
}

describe('FilterChipBar', () => {
  it('renders combinator, chips and add buttons', () => {
    const w = mountBar()
    expect(w.find('[data-testid="combinator-toggle"]').exists()).toBe(true)
    expect(w.findAll('[data-testid="bar-filter-chip"]')).toHaveLength(1)
    expect(w.findAll('[data-testid="bar-sort-chip"]')).toHaveLength(1)
    expect(w.find('[data-testid="bar-group-chip"]').exists()).toBe(true)
    expect(w.find('[data-testid="bar-add-filter"]').exists()).toBe(true)
    expect(w.find('[data-testid="bar-add-sort"]').exists()).toBe(true)
    expect(w.find('[data-testid="bar-advanced"]').exists()).toBe(true)
  })

  it('clicking a filter chip opens ConditionPopover', async () => {
    const w = mountBar()
    await w.find('[data-testid="bar-filter-chip"]').trigger('click')
    expect(w.find('[data-testid="stub-cond"]').exists()).toBe(true)
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
    // 此前会因为 fieldOf(...) 返回 undefined 而被 `!` 断言掩盖，触发
    // "Cannot read properties of undefined (reading 'label')"。
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
    // 回灌 v-model 才能看到 DOM 更新
    const m = w.emitted('update:modelValue')!.at(-1)![0] as ViewQuery
    await w.setProps({ modelValue: m })
    expect(w.findAll('[data-testid="bar-filter-chip"]')).toHaveLength(2)
    expect(w.find('[data-testid="stub-cond"]').exists()).toBe(true)
  })

  it('+ Sort appends a sort rule and opens SortMenu', async () => {
    const w = mountBar()
    await w.find('[data-testid="bar-add-sort"]').trigger('click')
    await w.vm.$nextTick()
    const m = w.emitted('update:modelValue')!.at(-1)![0] as ViewQuery
    await w.setProps({ modelValue: m })
    expect(w.findAll('[data-testid="bar-sort-chip"]')).toHaveLength(2)
    expect(w.find('[data-testid="stub-sort"]').exists()).toBe(true)
    expect(m.sort).toHaveLength(2)
  })

  it('removing the group chip clears groupBy', async () => {
    const w = mountBar()
    await w.find('[data-testid="group-chip-x"]').trigger('click')
    await w.vm.$nextTick()
    const m = w.emitted('update:modelValue')!.at(-1)![0] as ViewQuery
    await w.setProps({ modelValue: m })
    expect(w.find('[data-testid="bar-group-chip"]').exists()).toBe(false)
    expect(w.find('[data-testid="bar-add-group"]').exists()).toBe(true)
    expect(m.groupBy).toBeNull()
  })

  it('+ Group → set groupBy opens GroupChip', async () => {
    const w = mountBar({ modelValue: { ...INITIAL, groupBy: null } })
    await w.find('[data-testid="bar-add-group"]').trigger('click')
    expect(w.find('[data-testid="stub-group"]').exists()).toBe(true)
    await w.findComponent({ name: 'GroupMenu' }).vm.$emit('update:groupBy', 'createdAt')
    await w.vm.$nextTick()
    const m = w.emitted('update:modelValue')!.at(-1)![0] as ViewQuery
    await w.setProps({ modelValue: m })
    expect(w.find('[data-testid="bar-group-chip"]').exists()).toBe(true)
  })

  it('nested filter degrades to aggregated chip', () => {
    const nested: ViewQuery = {
      version: 1,
      filter: {
        combinator: 'and',
        children: [{ combinator: 'or', children: [{ field: 'title', op: 'contains' }] }],
      },
      sort: [],
      groupBy: null,
    }
    const w = mountBar({ modelValue: nested })
    expect(w.find('[data-testid="bar-agg"]').exists()).toBe(true)
    expect(w.find('[data-testid="bar-filter-chip"]').exists()).toBe(false)
  })

  it('openSortMenu (no sorts) adds a sort and opens SortMenu', async () => {
    const w = mountBar({ modelValue: { ...INITIAL, sort: [] } })
    ;(w.vm as unknown as { openSortMenu: (el?: HTMLElement) => void }).openSortMenu(undefined)
    await w.vm.$nextTick()
    const m = w.emitted('update:modelValue')!.at(-1)![0] as ViewQuery
    expect(m.sort).toHaveLength(1)
    await w.setProps({ modelValue: m })
    expect(w.find('[data-testid="stub-sort"]').exists()).toBe(true)
  })

  it('openGroupMenu opens GroupMenu without mutating modelValue', async () => {
    const w = mountBar({ modelValue: { ...INITIAL, groupBy: null } })
    ;(w.vm as unknown as { openGroupMenu: (el?: HTMLElement) => void }).openGroupMenu(undefined)
    await w.vm.$nextTick()
    expect(w.find('[data-testid="stub-group"]').exists()).toBe(true)
    expect(w.emitted('update:modelValue')).toBeUndefined()
  })

  it('FieldSelectMenu "Add advanced filter" emits open-advanced', async () => {
    const w = mountBar()
    await w.find('[data-testid="bar-add-filter"]').trigger('click')
    await w.findComponent({ name: 'FieldSelectMenu' }).vm.$emit('advanced')
    await w.vm.$nextTick()
    expect(w.emitted('open-advanced')).toBeDefined()
  })

  it('aggregated chip emits open-advanced (escape hatch to FilterBuilder)', async () => {
    const nested: ViewQuery = {
      version: 1,
      filter: {
        combinator: 'and',
        children: [{ combinator: 'or', children: [{ field: 'title', op: 'contains' }] }],
      },
      sort: [],
      groupBy: null,
    }
    const w = mountBar({ modelValue: nested })
    await w.find('[data-testid="bar-agg"]').trigger('click')
    await w.vm.$nextTick()
    expect(w.emitted('open-advanced')).toBeDefined()
  })
})
