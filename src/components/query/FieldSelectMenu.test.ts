import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import FieldSelectMenu from './FieldSelectMenu.vue'
import type { FieldDescriptor } from '../../core/query'

const BasePopoverStub = {
  props: ['visible', 'position', 'closeOnOverlay'],
  emits: ['close'],
  template: `<div class="bp" @click.self="$emit('close')"><slot /></div>`,
}

const FIELDS: FieldDescriptor[] = [
  { key: 'title', label: '标题', type: 'text', get: () => '' },
  { key: 'type', label: '类型', type: 'select', get: () => '' },
  { key: 'createdAt', label: '创建日期', type: 'date', get: () => '' },
]

describe('FieldSelectMenu', () => {
  it('lists all fields', () => {
    const w = mount(FieldSelectMenu, { props: { fields: FIELDS }, global: { stubs: { BasePopover: BasePopoverStub } } })
    expect(w.findAll('[data-testid="field-option"]')).toHaveLength(3)
  })

  it('search filters fields by label', async () => {
    const w = mount(FieldSelectMenu, { props: { fields: FIELDS }, global: { stubs: { BasePopover: BasePopoverStub } } })
    await w.find('[data-testid="field-search"]').setValue('日期')
    const opts = w.findAll('[data-testid="field-option"]')
    expect(opts).toHaveLength(1)
    expect(opts[0].text()).toContain('创建日期')
  })

  it('clicking a field emits select with its key', async () => {
    const w = mount(FieldSelectMenu, { props: { fields: FIELDS }, global: { stubs: { BasePopover: BasePopoverStub } } })
    await w.findAll('[data-testid="field-option"]')[1].trigger('click')
    expect(w.emitted('select')?.[0]).toEqual(['type'])
  })

  it('Add advanced filter emits advanced', async () => {
    const w = mount(FieldSelectMenu, { props: { fields: FIELDS }, global: { stubs: { BasePopover: BasePopoverStub } } })
    await w.find('[data-testid="field-advanced"]').trigger('click')
    expect(w.emitted('advanced')).toBeTruthy()
  })

  it('overlay click forwards close', async () => {
    const w = mount(FieldSelectMenu, { props: { fields: FIELDS }, global: { stubs: { BasePopover: BasePopoverStub } } })
    await w.find('.bp').trigger('click')
    expect(w.emitted('close')).toBeTruthy()
  })
})
