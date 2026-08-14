import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import FilterCombinatorToggle from './FilterCombinatorToggle.vue'

describe('FilterCombinatorToggle', () => {
  it('renders two options and reflects current value', () => {
    const w = mount(FilterCombinatorToggle, { props: { modelValue: 'and' } })
    expect(w.find('[data-testid="combinator-and"]').exists()).toBe(true)
    expect(w.find('[data-testid="combinator-or"]').exists()).toBe(true)
    expect(w.find('[data-testid="combinator-and"]').classes()).toContain('active')
  })

  it('clicking 或 emits or', async () => {
    const w = mount(FilterCombinatorToggle, { props: { modelValue: 'and' } })
    await w.find('[data-testid="combinator-or"]').trigger('click')
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['or'])
  })

  it('clicking 且 emits and', async () => {
    const w = mount(FilterCombinatorToggle, { props: { modelValue: 'or' } })
    await w.find('[data-testid="combinator-and"]').trigger('click')
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['and'])
  })
})
