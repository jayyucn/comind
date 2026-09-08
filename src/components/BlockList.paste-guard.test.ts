/**
 * BlockList 粘贴归属守卫回归测试（ADR-0043 实测 bug 修复）
 *
 * 背景：#82 粘贴即建页合入后实测出现两个症状——toast 双弹、今日 ideas 页莫名多 block。
 * 根因：BlockList 在 document 上注册 paste 捕获监听；RouterView KeepAlive 缓存 /ideas
 * 今日面板后，其 BlockList 实例（DOM 已脱离文档）的监听仍存活。用户在任意页粘贴时
 * 缓存实例与当前页实例都执行 ensureWikiLinkTargets（toast 双弹）并都 pasteBlocks
 * （内容二次插入今日 ideas 页）。
 *
 * 修复：handleDocPaste 增加归属守卫——事件落点不在本实例渲染树内、或本实例 DOM
 * 已摘离文档（KeepAlive 缓存态）→ 直接忽略。
 *
 * 本测试 mock ensureWikiLinkTargets/notifyCreatedPages 为 spy：派发一次 paste，
 * ensure 应恰好被调 1 次（仅激活实例）。若缓存实例未被守卫拦截，计数为 2。
 */
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import BlockList from './BlockList.vue'

const {
  ensureSpy,
  notifySpy,
} = vi.hoisted(() => ({
  ensureSpy: vi.fn(async () => ({ created: [] as string[] })),
  notifySpy: vi.fn(),
}))

vi.mock('../services/paste-ensure-wiki-targets', () => ({
  ensureWikiLinkTargets: ensureSpy,
  notifyCreatedPages: notifySpy,
}))

// jsdom 无 matchMedia；import 链中模块级求值可能调用（先例：TaskHub.test.ts）
vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

/** 构造带可读 text/plain 的 paste 事件（jsdom ClipboardEvent 构造器不支持 clipboardData） */
function makePasteEvent(plain: string): ClipboardEvent {
  const ev = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(ev, 'clipboardData', {
    value: {
      getData: (type: string) => (type === 'text/plain' ? plain : ''),
      types: ['text/plain'],
    },
  })
  return ev
}

async function flushAsync() {
  await flushPromises()
  await new Promise(r => setTimeout(r, 0))
  await flushPromises()
}

describe('BlockList 粘贴归属守卫（KeepAlive 缓存实例不得二次处理）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    ensureSpy.mockClear()
    notifySpy.mockClear()
  })

  test('激活实例：事件落点在其渲染树内 → ensure 恰好 1 次（自身处理）', async () => {
    const active = mount(BlockList, {
      props: { pageId: 'page-a' },
      attachTo: document.body,
      global: {
        stubs: {
          VueDraggable: { template: '<div><slot /></div>' },
          BlockDropIndicator: true,
        },
      },
    })
    // 树内「块」节点：粘贴事件的目标
    const host = document.createElement('div')
    host.dataset.blockId = 'block-in-a'
    active.element.appendChild(host)

    host.dispatchEvent(makePasteEvent('[[目标页]]'))
    await flushAsync()

    expect(ensureSpy).toHaveBeenCalledTimes(1)

    active.unmount()
  })

  test('缓存实例（DOM 摘离文档，模拟 KeepAlive deactivated）：同一粘贴不触发 ensure', async () => {
    const active = mount(BlockList, {
      props: { pageId: 'page-a' },
      attachTo: document.body,
      global: {
        stubs: {
          VueDraggable: { template: '<div><slot /></div>' },
          BlockDropIndicator: true,
        },
      },
    })
    // 缓存实例：不 attachTo → 根元素脱离文档（KeepAlive deactivated 同态）
    const cached = mount(BlockList, {
      props: { pageId: 'page-b' },
      global: {
        stubs: {
          VueDraggable: { template: '<div><slot /></div>' },
          BlockDropIndicator: true,
        },
      },
    })
    expect(cached.element.isConnected).toBe(false)

    const host = document.createElement('div')
    host.dataset.blockId = 'block-in-a'
    active.element.appendChild(host)

    host.dispatchEvent(makePasteEvent('[[目标页]]'))
    await flushAsync()

    // 守卫生效：仅激活实例处理一次；缓存实例被拦截
    expect(ensureSpy).toHaveBeenCalledTimes(1)

    active.unmount()
    cached.unmount()
  })

  test('事件落点在 BlockList 树外 → 不处理（contains 判定）', async () => {
    const active = mount(BlockList, {
      props: { pageId: 'page-a' },
      attachTo: document.body,
      global: {
        stubs: {
          VueDraggable: { template: '<div><slot /></div>' },
          BlockDropIndicator: true,
        },
      },
    })

    const outside = document.createElement('div')
    document.body.appendChild(outside) // 树外（不属于任何 BlockList）

    outside.dispatchEvent(makePasteEvent('[[目标页]]'))
    await flushAsync()

    expect(ensureSpy).not.toHaveBeenCalled()

    outside.remove()
    active.unmount()
  })
})
