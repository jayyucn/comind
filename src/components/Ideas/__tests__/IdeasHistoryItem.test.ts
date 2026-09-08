import { describe, test, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('../../../stores/pages', () => ({
  usePageStore: () => ({
    // 纯快照驱动：IdeasHistoryItem 直接读 ideasSnapshots[pageId]
    ideasSnapshots: {
      'page-2': { title: '2026-08-02', blocks: [], properties: {} },
    },
    // IdeasSnapshotPage 内部经 getIdeasSnapshot 异步读取正文（ADR-0042 T5）
    getIdeasSnapshot: vi.fn(async (pageId: string) => {
      if (pageId === 'page-2') return { title: '2026-08-02', blocks: [], properties: {} }
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

  // T5 渲染面切换：历史 ideas 页正文统一走 IdeasSnapshotPage 快照只读视图，
  // 不再渲染活数据 BlockList（原「renders BlockList」断言随 T5 失效）。
  test('renders snapshot view for the stale ideas page', async () => {
    const wrapper = mount(IdeasHistoryItem, {
      props: { pageId: 'page-2' },
    })
    await flushPromises()
    expect(wrapper.find('[data-snapshot-view]').exists()).toBe(true)
  })

  test('renders nothing when page is not found', () => {
    const wrapper = mount(IdeasHistoryItem, {
      props: { pageId: 'nonexistent' },
    })
    expect(wrapper.find('.history-item').exists()).toBe(false)
  })
})
