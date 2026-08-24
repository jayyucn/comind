import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PaginationFooter from './PaginationFooter.vue'

function mountFooter(props: Record<string, unknown> = {}) {
  return mount(PaginationFooter, {
    props: {
      total: 120,
      page: 1,
      totalPages: 3,
      pageSize: 50,
      ...props,
    },
  })
}

describe('PaginationFooter (ADR-0024 D4, 受控组件)', () => {
  it('renders total, page info and size options', () => {
    const wrapper = mountFooter()
    expect(wrapper.text()).toContain('共 120 条')
    expect(wrapper.text()).toContain('第 1/3 页')
    const options = wrapper.findAll('option').map((o) => o.text())
    expect(options).toContain('20 条/页')
    expect(options).toContain('50 条/页')
    expect(options).toContain('100 条/页')
  })

  it('disables prev on first page and next on last page', () => {
    const first = mountFooter({ page: 1 })
    expect(first.find('[data-testid="page-prev"]').attributes('disabled')).toBeDefined()
    expect(first.find('[data-testid="page-next"]').attributes('disabled')).toBeUndefined()

    const last = mountFooter({ page: 3, totalPages: 3 })
    expect(last.find('[data-testid="page-next"]').attributes('disabled')).toBeDefined()
    expect(last.find('[data-testid="page-prev"]').attributes('disabled')).toBeUndefined()
  })

  it('emits update:page on prev/next clicks', async () => {
    const wrapper = mountFooter({ page: 2, totalPages: 3 })
    await wrapper.find('[data-testid="page-prev"]').trigger('click')
    expect(wrapper.emitted('update:page')).toEqual([[1]])
    await wrapper.find('[data-testid="page-next"]').trigger('click')
    expect(wrapper.emitted('update:page')).toEqual([[1], [3]])
  })

  it('does not emit when clicking disabled buttons', async () => {
    const wrapper = mountFooter({ page: 1, totalPages: 1 })
    await wrapper.find('[data-testid="page-prev"]').trigger('click')
    await wrapper.find('[data-testid="page-next"]').trigger('click')
    expect(wrapper.emitted('update:page')).toBeUndefined()
  })

  it('emits update:pageSize on select change', async () => {
    const wrapper = mountFooter()
    await wrapper.find('[data-testid="page-size-select"]').setValue('100')
    expect(wrapper.emitted('update:pageSize')).toEqual([[100]])
  })
})
