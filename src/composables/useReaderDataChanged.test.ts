// 主窗口跨窗口刷新单测（票 06 / ADR-0040 D4）：监听 'reader:data-changed'
// → 重载对应 page blocks（v1 粗粒度）；window focus 兜底刷新当前打开的
// /page/:pageId（跨窗口事件丢失时）。mock Tauri event API。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'

const { mockListen, mockLoadPageBlocks, mockIsTauri, mockRoute } = vi.hoisted(() => ({
  mockListen: vi.fn(),
  mockLoadPageBlocks: vi.fn(),
  mockIsTauri: vi.fn(),
  mockRoute: { name: 'page', params: { pageId: 'p-current' } } as {
    name: string
    params: Record<string, string>
  },
}))

vi.mock('@tauri-apps/api/event', () => ({ listen: mockListen }))
vi.mock('vue-router', () => ({ useRoute: () => mockRoute }))
vi.mock('../wasm/tauri-platform', () => ({ isTauriEnvironment: () => mockIsTauri() }))
vi.mock('../stores/blocks', () => ({
  useBlockStore: () => ({ loadPageBlocks: mockLoadPageBlocks }),
}))

import { useReaderDataChanged } from './useReaderDataChanged'

/** 包一层宿主组件：composable 需要 setup 上下文挂 onMounted/onBeforeUnmount */
function mountHost() {
  const Host = defineComponent({
    setup() {
      useReaderDataChanged()
      return () => h('div')
    },
  })
  return mount(Host)
}

/** 捕获 listen 注册的事件回调（手动触发模拟跨窗口事件） */
function registeredHandler(): (e: { payload: unknown }) => void {
  const calls = mockListen.mock.calls as unknown as Array<[string, (e: { payload: unknown }) => void]>
  const jumpCall = calls.find(c => c[0] === 'reader:data-changed')
  if (!jumpCall) throw new Error('reader:data-changed 未注册监听')
  return jumpCall[1]
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsTauri.mockReturnValue(true)
  mockListen.mockReset()
  mockListen.mockImplementation(async () => vi.fn())
  mockLoadPageBlocks.mockReset()
  mockLoadPageBlocks.mockResolvedValue(undefined)
})

describe('useReaderDataChanged（主窗口侧监听）', () => {
  it('注册 reader:data-changed 监听（Tauri 环境）', () => {
    mountHost()

    expect(mockListen).toHaveBeenCalledWith('reader:data-changed', expect.any(Function))
  })

  it('事件到达：按 payload.pageId 重载对应 page blocks', async () => {
    mountHost()

    registeredHandler()({ payload: { pageId: 'book-1' } })
    await Promise.resolve()

    expect(mockLoadPageBlocks).toHaveBeenCalledWith('book-1')
  })

  it('payload 缺 pageId 时不重载（异常数据防御）', async () => {
    mountHost()

    registeredHandler()({ payload: {} })
    await Promise.resolve()

    expect(mockLoadPageBlocks).not.toHaveBeenCalled()
  })

  it('window focus 兜底：重载当前打开的 /page/:pageId（事件丢失场景）', async () => {
    mountHost()

    window.dispatchEvent(new Event('focus'))
    await Promise.resolve()

    expect(mockLoadPageBlocks).toHaveBeenCalledWith('p-current')
  })

  it('focus 时不在笔记页路由（如图谱）：不重载', async () => {
    mockRoute.name = 'graph'
    try {
      mountHost()

      window.dispatchEvent(new Event('focus'))
      await Promise.resolve()

      expect(mockLoadPageBlocks).not.toHaveBeenCalled()
    } finally {
      mockRoute.name = 'page'
    }
  })

  it('非 Tauri 环境不注册监听（web/Android 无跨窗口）', () => {
    mockIsTauri.mockReturnValue(false)

    mountHost()

    expect(mockListen).not.toHaveBeenCalled()
  })

  it('卸载时解绑事件与 focus 监听（防泄漏）', async () => {
    const mockUnlisten = vi.fn()
    mockListen.mockImplementation(async () => mockUnlisten)
    const wrapper = mountHost()
    // 等待 listen promise resolve
    await Promise.resolve()

    wrapper.unmount()

    expect(mockUnlisten).toHaveBeenCalled()
  })
})
