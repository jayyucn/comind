import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SortMenu from './SortMenu.vue'
import type { FieldDescriptor, SortRule } from '../../core/query'

const FIELDS: FieldDescriptor[] = [
  { key: 'title', label: '标题', type: 'text', get: () => '' },
  { key: 'createdAt', label: '创建日期', type: 'date', get: () => '' },
  { key: 'wordCount', label: '字数', type: 'number', get: () => 0 },
]

const SORTS: SortRule[] = [
  { field: 'title', dir: 'asc' },
  { field: 'createdAt', dir: 'desc' },
]

function lastSort(wrapper: ReturnType<typeof mount>): SortRule[] {
  const e = wrapper.emitted('update:sort')
  return e![e!.length - 1][0] as SortRule[]
}

describe('SortMenu', () => {
  it('renders one row per sort rule', () => {
    const w = mount(SortMenu, {
      props: { sort: SORTS, fields: FIELDS },
    })
    expect(w.findAll('[data-testid="sort-row"]')).toHaveLength(2)
    expect(w.find('[data-testid="sort-add"]').exists()).toBe(true)
    expect(w.find('[data-testid="sort-del-all"]').exists()).toBe(true)
  })

  it('changing field emits updated sort array', async () => {
    const w = mount(SortMenu, {
      props: { sort: SORTS, fields: FIELDS },
    })
    const selects = w.findAll('[data-testid="sort-field"]')
    const sel = selects[0].element as HTMLSelectElement
    sel.value = 'wordCount'
    await selects[0].trigger('change')
    const out = lastSort(w)
    expect(out[0].field).toBe('wordCount')
    expect(out[1].field).toBe('createdAt')
  })

  it('changing direction emits updated sort array', async () => {
    const w = mount(SortMenu, {
      props: { sort: SORTS, fields: FIELDS },
    })
    const selects = w.findAll('[data-testid="sort-dir"]')
    const sel = selects[0].element as HTMLSelectElement
    sel.value = 'desc'
    await selects[0].trigger('change')
    const out = lastSort(w)
    expect(out[0].dir).toBe('desc')
    expect(out[1].dir).toBe('desc')
  })

  it('clicking row × removes that rule', async () => {
    const w = mount(SortMenu, {
      props: { sort: SORTS, fields: FIELDS },
    })
    await w.findAll('[data-testid="sort-row-remove"]')[0].trigger('click')
    const out = lastSort(w)
    expect(out).toHaveLength(1)
    expect(out[0].field).toBe('createdAt')
  })

  it('+ Add sort appends a default asc rule', async () => {
    const w = mount(SortMenu, {
      props: { sort: [SORTS[0]], fields: FIELDS },
    })
    await w.find('[data-testid="sort-add"]').trigger('click')
    const out = lastSort(w)
    expect(out).toHaveLength(2)
    expect(out[1].field).toBe(FIELDS[0].key)
    expect(out[1].dir).toBe('asc')
  })

  it('Delete sort clears all rules and closes', async () => {
    const w = mount(SortMenu, {
      props: { sort: SORTS, fields: FIELDS },
    })
    await w.find('[data-testid="sort-del-all"]').trigger('click')
    const out = w.emitted('update:sort')!.at(-1)![0] as SortRule[]
    expect(out).toHaveLength(0)
    expect(w.emitted('close')).toBeTruthy()
  })
})
