import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SortChip from './SortChip.vue'
import type { SortRule } from '../../core/query'

describe('SortChip', () => {
  it('shows desc arrow for desc rule', () => {
    const rule: SortRule = { field: 'title', dir: 'desc' }
    const w = mount(SortChip, { props: { rule, label: '标题' } })
    const label = w.find('[data-testid="sort-chip-label"]').text()
    expect(label).toContain('↓')
    expect(label).toContain('标题')
  })

  it('shows asc arrow for asc rule', () => {
    const rule: SortRule = { field: 'createdAt', dir: 'asc' }
    const w = mount(SortChip, { props: { rule, label: '创建日期' } })
    expect(w.find('[data-testid="sort-chip-label"]').text()).toContain('↑')
  })

  it('clicking chip body emits open', async () => {
    const w = mount(SortChip, { props: { rule: { field: 'title', dir: 'asc' }, label: '标题' } })
    await w.find('[data-testid="sort-chip"]').trigger('click')
    expect(w.emitted('open')).toBeTruthy()
  })

  it('clicking × emits remove and not open', async () => {
    const w = mount(SortChip, { props: { rule: { field: 'title', dir: 'asc' }, label: '标题' } })
    await w.find('[data-testid="sort-chip-x"]').trigger('click')
    expect(w.emitted('remove')).toBeTruthy()
    expect(w.emitted('open')).toBeFalsy()
  })
})
