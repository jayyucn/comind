import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import GroupChip from './GroupChip.vue'

describe('GroupChip', () => {
  it('shows the field label', () => {
    const w = mount(GroupChip, { props: { label: '类型' } })
    expect(w.find('[data-testid="group-chip-label"]').text()).toContain('分组：类型')
  })

  it('clicking chip body emits open', async () => {
    const w = mount(GroupChip, { props: { label: '类型' } })
    await w.find('[data-testid="group-chip"]').trigger('click')
    expect(w.emitted('open')).toBeTruthy()
  })

  it('clicking × emits remove and not open', async () => {
    const w = mount(GroupChip, { props: { label: '类型' } })
    await w.find('[data-testid="group-chip-x"]').trigger('click')
    expect(w.emitted('remove')).toBeTruthy()
    expect(w.emitted('open')).toBeFalsy()
  })
})
