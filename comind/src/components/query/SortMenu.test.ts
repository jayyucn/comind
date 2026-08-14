import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SortMenu from './SortMenu.vue'
import type { FieldDescriptor, SortRule } from '../../core/query'

const BasePopoverStub = {
  props: ['visible', 'position', 'closeOnOverlay'],
  emits: ['close'],
  template: `<div class="bp" @click.self="$emit('close')"><slot /></div>`,
}

const FIELDS: FieldDescriptor[] = [
  { key: 'title', label: '标题', type: 'text', get: () => '' },
  { key: 'createdAt', label: '创建日期', type: 'date', get: () => '' },
  { key: 'wordCount', label: '字数', type: 'number', get: () => 0 },
]

function lastRule(wrapper: ReturnType<typeof mount>): SortRule {
  const e = wrapper.emitted('update:rule')
  return e![e!.length - 1][0] as SortRule
}

describe('SortMenu', () => {
  it('renders field select + direction toggle', () => {
    const w = mount(SortMenu, {
      props: { rule: { field: 'title', dir: 'asc' }, fields: FIELDS },
      global: { stubs: { BasePopover: BasePopoverStub } },
    })
    expect(w.find('[data-testid="sort-field"]').exists()).toBe(true)
    expect(w.find('[data-testid="sort-asc"]').exists()).toBe(true)
    expect(w.find('[data-testid="sort-desc"]').exists()).toBe(true)
    expect(w.find('[data-testid="sort-add"]').exists()).toBe(true)
    expect(w.find('[data-testid="sort-del"]').exists()).toBe(true)
  })

  it('changing field emits updated rule', async () => {
    const w = mount(SortMenu, {
      props: { rule: { field: 'title', dir: 'asc' }, fields: FIELDS },
      global: { stubs: { BasePopover: BasePopoverStub } },
    })
    const sel = w.find('[data-testid="sort-field"]').element as HTMLSelectElement
    sel.value = 'createdAt'
    await w.find('[data-testid="sort-field"]').trigger('change')
    const out = lastRule(w)
    expect(out.field).toBe('createdAt')
    expect(out.dir).toBe('asc')
  })

  it('clicking Z→A emits desc', async () => {
    const w = mount(SortMenu, {
      props: { rule: { field: 'title', dir: 'asc' }, fields: FIELDS },
      global: { stubs: { BasePopover: BasePopoverStub } },
    })
    await w.find('[data-testid="sort-desc"]').trigger('click')
    expect(lastRule(w).dir).toBe('desc')
  })

  it('add / remove / close emit their events', async () => {
    const w = mount(SortMenu, {
      props: { rule: { field: 'title', dir: 'asc' }, fields: FIELDS },
      global: { stubs: { BasePopover: BasePopoverStub } },
    })
    await w.find('[data-testid="sort-add"]').trigger('click')
    await w.find('[data-testid="sort-del"]').trigger('click')
    await w.find('[data-testid="sort-menu"]').trigger('click')
    expect(w.emitted('add')).toBeTruthy()
    expect(w.emitted('remove')).toBeTruthy()
    // sort-menu 自身点击不应触发 close（冒泡到 overlay 才关）
    expect(w.emitted('close')).toBeFalsy()
  })
})
