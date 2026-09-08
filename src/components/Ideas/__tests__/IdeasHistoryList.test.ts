import { describe, test, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

// 与 IdeasHistoryItem.test.ts 同范式：模块级 mock page store。
// 组件（IdeasHistoryList.vue）内 import '../../stores/pages' 与测试文件的
// '../../../stores/pages' 解析到同一模块，vi.mock 按解析后 id 命中。
vi.mock('../../../stores/pages', () => {
  const now = new Date()
  const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  // ⚠️ vi.fn 必须提升到工厂顶层：usePageStore 每次调用若新建 vi.fn，
  // 测试断言手里的实例与组件调用的实例不是同一个，toHaveBeenCalled 恒失败。
  const loadIdeasSnapshotMonths = vi.fn(async () => {})
  const loadIdeasSnapshotsByMonth = vi.fn(async () => {})
  const getIdeasSnapshot = vi.fn(async () => ({ title: `${cur}-01`, blocks: [], properties: {} }))
  return {
    usePageStore: () => ({
      ideasMonths: [cur],
      // 纯快照驱动：IdeasHistoryItem 直接读 ideasSnapshots[pageId]
      ideasSnapshots: { 'p1': { title: `${cur}-01`, blocks: [], properties: {} } },
      loadIdeasSnapshotMonths,
      loadIdeasSnapshotsByMonth,
      getIdeasSnapshot,
      ideasHistoryPages: (month: string) =>
        month === cur ? [{ pageId: 'p1', title: `${cur}-01` }] : [],
    }),
  }
})

vi.mock('../../../composables/useTheme', () => ({
  useTheme: () => ({
    theme: { value: 'light' },
    setTheme: vi.fn(),
    toggleTheme: vi.fn(),
  }),
  resolve: vi.fn(() => 'light'),
}))

import { usePageStore } from '../../../stores/pages'
import IdeasHistoryList from '../IdeasHistoryList.vue'

/** 从 mock store 取共享方法实例（工厂顶层 vi.fn，测试与组件同实例） */
function storeFns() {
  return usePageStore()
}

describe('IdeasHistoryList 按月异步', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  test('挂载后拉月份并加载当前月，渲染历史项', async () => {
    const fns = storeFns()
    const wrapper = mount(IdeasHistoryList)
    await flushPromises()

    expect(fns.loadIdeasSnapshotMonths).toHaveBeenCalledTimes(1)
    expect(fns.loadIdeasSnapshotsByMonth).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.history-item').exists()).toBe(true)
    expect(wrapper.find('.empty-state').exists()).toBe(false)
    expect(wrapper.find('.error-state').exists()).toBe(false)
  })

  test('某月快照拉取失败 → 显示错误态而非误导性空态', async () => {
    const fns = storeFns()
    vi.mocked(fns.loadIdeasSnapshotsByMonth).mockRejectedValueOnce(new Error('boom'))
    const wrapper = mount(IdeasHistoryList)
    await flushPromises()

    expect(wrapper.find('.error-state').exists()).toBe(true)
    expect(wrapper.find('.error-text').text()).toContain('加载失败')
    expect(wrapper.find('.empty-state').exists()).toBe(false)
  })
})
