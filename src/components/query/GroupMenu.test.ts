import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import GroupMenu from './GroupMenu.vue'
import type { FieldDescriptor } from '../../core/query'

const BasePopoverStub = {
  props: ['visible', 'position', 'closeOnOverlay'],
  emits: ['close'],
  template: `<div class="bp" @click.self="$emit('close')"><slot /></div>`,
}

const FIELDS: FieldDescriptor[] = [
  { key: 'type', label: '类型', type: 'select', options: [], get: () => '' },
  { key: 'createdAt', label: '创建日期', type: 'date', get: () => '' },
]

describe('GroupMenu', () => {
  it('renders none option + field list', () => {
    const w = mount(GroupMenu, {
      props: { groupBy: null, fields: FIELDS },
      global: { stubs: { BasePopover: BasePopoverStub } },
    })
    expect(w.find('[data-testid="group-none"]').exists()).toBe(true)
    expect(w.findAll('[data-testid="group-item"]')).toHaveLength(2)
  })

  it('selecting a field emits that key', async () => {
    const w = mount(GroupMenu, {
      props: { groupBy: null, fields: FIELDS },
      global: { stubs: { BasePopover: BasePopoverStub } },
    })
    await w.findAll('[data-testid="group-item"]')[0].trigger('click')
    expect(w.emitted('update:groupBy')![0]).toEqual(['type'])
  })

  it('clicking 不分组 emits null', async () => {
    const w = mount(GroupMenu, {
      props: { groupBy: 'type', fields: FIELDS },
      global: { stubs: { BasePopover: BasePopoverStub } },
    })
    await w.find('[data-testid="group-none"]').trigger('click')
    expect(w.emitted('update:groupBy')![0]).toEqual([null])
  })
})
