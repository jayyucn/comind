import { describe, test, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('../../../stores/pages', () => ({
  usePageStore: () => ({
    getPage: vi.fn((id: string) => {
      if (id === 'page-2') return { id, title: '2026-08-02', type: 'ideas' }
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

import IdeasHistoryItem from '../IdeasHistoryItem.vue'

describe('IdeasHistoryItem', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  test('renders history item with date header', () => {
    const wrapper = mount(IdeasHistoryItem, {
      props: { pageId: 'page-2' },
    })
    expect(wrapper.find('.history-item').exists()).toBe(true)
    expect(wrapper.find('.history-date').exists()).toBe(true)
    expect(wrapper.find('.history-weekday').exists()).toBe(true)
  })

  test('renders BlockList with correct pageId', () => {
    const wrapper = mount(IdeasHistoryItem, {
      props: { pageId: 'page-2' },
    })
    const blockList = wrapper.findComponent({ name: 'BlockList' })
    expect(blockList.exists()).toBe(true)
    expect(blockList.props('pageId')).toBe('page-2')
  })

  test('renders nothing when page is not found', () => {
    const wrapper = mount(IdeasHistoryItem, {
      props: { pageId: 'nonexistent' },
    })
    expect(wrapper.find('.history-item').exists()).toBe(false)
  })
})
