import { describe, test, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('../../../stores/pages', () => ({
  usePageStore: () => ({
    getPage: vi.fn((id: string) => {
      if (id === 'page-1') return { id, title: '2026-08-03', type: 'ideas' }
      return null
    }),
  }),
}))

vi.mock('../../../composables/useTheme', () => ({
  useTheme: () => ({
    theme: { value: 'light' },
    setTheme: vi.fn(),
    toggleTheme: vi.fn(),
  }),
  resolve: vi.fn(() => 'light'),
}))

vi.mock('../BlockList.vue', () => ({
  default: {
    name: 'BlockList',
    props: { pageId: String },
    template: '<div class="mock-block-list">{{ pageId }}</div>',
  },
}))

import IdeasTodayPanel from '../IdeasTodayPanel.vue'

describe('IdeasTodayPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  test('renders today card with correct title and badge', () => {
    const wrapper = mount(IdeasTodayPanel, {
      props: { pageId: 'page-1' },
    })
    expect(wrapper.find('.today-panel').exists()).toBe(true)
    expect(wrapper.find('.today-badge').text()).toContain('今天')
    expect(wrapper.find('.today-label').text()).toContain('可编辑')
  })

  test('renders BlockList with correct pageId', () => {
    const wrapper = mount(IdeasTodayPanel, {
      props: { pageId: 'page-1' },
    })
    const blockList = wrapper.findComponent({ name: 'BlockList' })
    expect(blockList.exists()).toBe(true)
    expect(blockList.props('pageId')).toBe('page-1')
  })

  test('renders nothing when page is not found', () => {
    const wrapper = mount(IdeasTodayPanel, {
      props: { pageId: 'nonexistent' },
    })
    expect(wrapper.find('.today-panel').exists()).toBe(false)
  })
})
