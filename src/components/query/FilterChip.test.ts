import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import FilterChip from './FilterChip.vue'

describe('FilterChip', () => {
  it('renders label and is clickable', async () => {
    const w = mount(FilterChip, { props: { label: '类型 是 普通' } })
    expect(w.text()).toContain('类型 是 普通')
    await w.find('[data-testid="filter-chip"]').trigger('click')
    expect(w.emitted('click')).toBeTruthy()
  })

  it('active prop toggles active class', () => {
    const off = mount(FilterChip, { props: { label: 'x', active: false } })
    const on = mount(FilterChip, { props: { label: 'x', active: true } })
    expect(off.find('[data-testid="filter-chip"]').classes()).not.toContain('active')
    expect(on.find('[data-testid="filter-chip"]').classes()).toContain('active')
  })

  it('remove button emits remove and does not bubble to chip click', async () => {
    const w = mount(FilterChip, { props: { label: 'x' } })
    await w.find('[data-testid="chip-remove"]').trigger('click')
    expect(w.emitted('remove')).toBeTruthy()
    expect(w.emitted('click')).toBeFalsy()
  })
})
