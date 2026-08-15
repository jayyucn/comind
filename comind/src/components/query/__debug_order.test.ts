import { describe, it } from 'vitest'
import { mount } from '@vue/test-utils'
import FilterChipBar from './FilterChipBar.vue'
import type { FieldDescriptor, Registry, ViewQuery } from '../../core/query'

const FIELDS: FieldDescriptor[] = [
  { key: 'title', label: '标题', type: 'text', get: () => '' },
  { key: 'type', label: '类型', type: 'select', options: [{ id: 'normal', label: '普通' }], get: () => '' },
  { key: 'createdAt', label: '创建日期', type: 'date', get: () => '' },
]
const FAKE_REGISTRY = { list: () => FIELDS, get: () => undefined, subscribe: () => () => {} } as unknown as Registry
const model: ViewQuery = {
  version: 1,
  filter: { combinator: 'and', children: [
    { field: 'title', op: 'contains', value: { kind: 'literal', value: 'x' } },
    { combinator: 'or', children: [{ field: 'createdAt', op: 'before' }] },
  ] },
  sort: [{ field: 'createdAt', dir: 'desc' }],
  groupBy: 'type',
}
describe('dbg', () => {
  it('print children', () => {
    const w = mount(FilterChipBar, { props: { modelValue: model, fields: FIELDS, registry: FAKE_REGISTRY, entityType: 'page' } })
    const kids = Array.from(w.find('.chip-bar').element.children).map((e) => (e as HTMLElement).getAttribute('data-testid'))
    console.log('CHILDREN:', JSON.stringify(kids))
  })
})
