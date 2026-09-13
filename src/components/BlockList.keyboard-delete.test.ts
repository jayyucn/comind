/**
 * BlockList 删除键四格分派回归测试（#95 / #96）
 *
 * 覆盖矩阵：{块选区, 跨块文本选区} × {Backspace, Delete}
 * 断言口径 = 文档级 keydown 确实被 BlockList 接管（preventDefault）且落到正确分支
 * （经真实落库结果观察，而非替身计数）。
 *
 * 夹具照 BlockList.paste-guard.test.ts：mount(BlockList) + 文档级派发。
 * 选区状态经组件自己 provide 的实例写入（与真机诊断同法：根元素
 * `__vueParentComponent.provides.crossBlockSelection`），不 mock 选区 composable——
 * 这样被验证的是「分派 + 选区编排 + store」整条链路。
 *
 * 唯一夹具：`getCoreClient().extractLinksFromContent`。jsdom 下 WasmClientAdapter 里
 * 该方法是硬编码 throw（既存环境局限，非本功能问题），会让块选区删除路径整体 reject。
 * 只把这一个原语替换成空结果，关系清理 cleanupAfterDelete 仍走真实实现。
 */
import { describe, test, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import BlockList from './BlockList.vue'
import { useBlockStore } from '../stores/blocks'
import { getCoreClient } from '../wasm/client'
import type { CrossBlockSelection } from '../composables/useCrossBlockSelection'

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

const stubGlobal = {
  stubs: {
    VueDraggable: { template: '<div><slot /></div>' },
    BlockDropIndicator: true,
  },
}

function mountBlockList(pageId: string): VueWrapper {
  return mount(BlockList, {
    props: { pageId },
    attachTo: document.body,
    global: stubGlobal,
  })
}

/** 取组件自己 provide 的选区实例（与真机诊断取法一致） */
function getSelection(wrapper: VueWrapper): CrossBlockSelection {
  const root = wrapper.element as HTMLElement & {
    __vueParentComponent?: { provides?: Record<string, unknown> }
  }
  const selection = root.__vueParentComponent?.provides?.crossBlockSelection
  if (!selection) throw new Error('未取到 crossBlockSelection（组件未 provide？）')
  return selection as CrossBlockSelection
}

/** 文档级派发删除键，返回事件以便断言 defaultPrevented */
function dispatchDeleteKey(key: 'Backspace' | 'Delete'): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  document.body.dispatchEvent(ev)
  return ev
}

async function flushAsync() {
  await flushPromises()
  await new Promise(r => setTimeout(r, 0))
  await flushPromises()
}

describe('BlockList 删除键四格分派（#95 / #96）', () => {
  let extractLinksSpy: MockInstance

  beforeEach(() => {
    setActivePinia(createPinia())
    // 仅替换 jsdom 下不可用的原语，其余（cleanupAfterDelete / deleteBlocks）走真实实现
    extractLinksSpy = vi
      .spyOn(getCoreClient()!, 'extractLinksFromContent')
      .mockResolvedValue([])
  })

  afterEach(() => {
    extractLinksSpy.mockRestore()
  })

  test('文本选区 + Backspace：裁剪合并落到 store，并 preventDefault', async () => {
    const store = useBlockStore()
    const pageId = 'page-keydel-text-bs'

    const a = await store.createBlock({ pageId, content: 'hello' })
    const b = await store.createBlock({ pageId, content: 'world' })

    const wrapper = mountBlockList(pageId)
    const selection = getSelection(wrapper)
    selection.startTextTracking({ blockId: a.id, offset: 2 }, { x: 0, y: 0 })
    selection.updateTextDrag({ blockId: b.id, offset: 3 })
    selection.finalizeTextDrag()
    expect(selection.textRange.value).not.toBeNull()

    const ev = dispatchDeleteKey('Backspace')
    await flushAsync()

    expect(ev.defaultPrevented).toBe(true)
    expect(store.blocks.find(x => x.id === a.id)?.content).toBe('held')
    expect(store.blocks.find(x => x.id === b.id)).toBeUndefined()
    expect(selection.textRange.value).toBeNull()

    wrapper.unmount()
  })

  test('文本选区 + Delete：与 Backspace 同语义（选中即被支配）', async () => {
    const store = useBlockStore()
    const pageId = 'page-keydel-text-del'

    const a = await store.createBlock({ pageId, content: 'alpha' })
    const b = await store.createBlock({ pageId, content: 'beta' })

    const wrapper = mountBlockList(pageId)
    const selection = getSelection(wrapper)
    selection.startTextTracking({ blockId: a.id, offset: 1 }, { x: 0, y: 0 })
    selection.updateTextDrag({ blockId: b.id, offset: 2 })
    selection.finalizeTextDrag()

    const ev = dispatchDeleteKey('Delete')
    await flushAsync()

    expect(ev.defaultPrevented).toBe(true)
    expect(store.blocks.find(x => x.id === a.id)?.content).toBe('ata')
    expect(store.blocks.find(x => x.id === b.id)).toBeUndefined()
    expect(selection.textRange.value).toBeNull()

    wrapper.unmount()
  })

  test('块选区 + Backspace：删除选中块（既有路径不回归）', async () => {
    const store = useBlockStore()
    const pageId = 'page-keydel-block-bs'

    const keep = await store.createBlock({ pageId, content: 'keep' })
    const drop = await store.createBlock({ pageId, content: 'drop' })

    const wrapper = mountBlockList(pageId)
    const selection = getSelection(wrapper)
    selection.toggleBlock(drop.id, pageId)
    expect(selection.anchorIds.has(drop.id)).toBe(true)

    const ev = dispatchDeleteKey('Backspace')
    await flushAsync()

    expect(ev.defaultPrevented).toBe(true)
    expect(store.blocks.find(x => x.id === drop.id)).toBeUndefined()
    expect(store.blocks.find(x => x.id === keep.id)).toBeDefined()

    wrapper.unmount()
  })

  test('块选区 + Delete：本轮补上的空格（#96）', async () => {
    const store = useBlockStore()
    const pageId = 'page-keydel-block-del'

    const keep = await store.createBlock({ pageId, content: 'keep' })
    const drop = await store.createBlock({ pageId, content: 'drop' })

    const wrapper = mountBlockList(pageId)
    const selection = getSelection(wrapper)
    selection.toggleBlock(drop.id, pageId)
    expect(selection.anchorIds.has(drop.id)).toBe(true)

    const ev = dispatchDeleteKey('Delete')
    await flushAsync()

    expect(ev.defaultPrevented).toBe(true)
    expect(store.blocks.find(x => x.id === drop.id)).toBeUndefined()
    expect(store.blocks.find(x => x.id === keep.id)).toBeDefined()

    wrapper.unmount()
  })

  test('无选区时删除键不接管（保留编辑器/浏览器默认）', async () => {
    const store = useBlockStore()
    const pageId = 'page-keydel-none'

    const a = await store.createBlock({ pageId, content: 'hello' })

    const wrapper = mountBlockList(pageId)
    const selection = getSelection(wrapper)
    expect(selection.textRange.value).toBeNull()

    const ev = dispatchDeleteKey('Delete')
    await flushAsync()

    expect(ev.defaultPrevented).toBe(false)
    expect(store.blocks.find(x => x.id === a.id)?.content).toBe('hello')

    wrapper.unmount()
  })
})
