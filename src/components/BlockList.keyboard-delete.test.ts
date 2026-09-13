/**
 * BlockList 删除键四格分派回归测试（#95 / #96）
 *
 * 覆盖矩阵：{块选区, 跨块文本选区} × {Backspace, Delete}，另含 Ctrl+X 剪切分派
 * （剪切 = 先复制后删除，共用同一张删除分派表）。
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

  test('文本选区跨中间块：中间整块经关系清理收口', async () => {
    const store = useBlockStore()
    const pageId = 'page-keydel-text-mid'

    const a = await store.createBlock({ pageId, content: 'head' })
    const mid = await store.createBlock({ pageId, content: 'mid-links-here' })
    const b = await store.createBlock({ pageId, content: 'tail' })

    const wrapper = mountBlockList(pageId)
    const selection = getSelection(wrapper)
    selection.startTextTracking({ blockId: a.id, offset: 1 }, { x: 0, y: 0 })
    selection.updateTextDrag({ blockId: b.id, offset: 2 })
    selection.finalizeTextDrag()

    const ev = dispatchDeleteKey('Delete')
    await flushAsync()

    expect(ev.defaultPrevented).toBe(true)
    // 中间整块消失，端点首尾拼接（'h' + 'il' = 'hil'）
    expect(store.blocks.find(x => x.id === mid.id)).toBeUndefined()
    expect(store.blocks.find(x => x.id === a.id)?.content).toBe('hil')
    expect(store.blocks.find(x => x.id === b.id)).toBeUndefined()
    // 收口证据：被删中间块的内容进入 cleanupAfterDelete 的目标提取（未接线时该调用根本不会发生）。
    // 尾端点被误纳入被删集时，它的原内容也会被提取 —— 这正是下面第二条断言要拦的。
    // 头端点在任何实现下都进不了被删集，故不设断言；本用例的 pageId 未注册进 pageStore，
    // cleanup 的 surviving 扫描（第 3 步）不会跑，被观察到的只有第 1 步的目标提取。
    expect(extractLinksSpy).toHaveBeenCalledWith('mid-links-here')
    expect(extractLinksSpy).not.toHaveBeenCalledWith('tail')

    wrapper.unmount()
  })

  test('文本选区跨端点片段：被裁片段进入清理的目标提取（#100 接线证据）', async () => {
    const store = useBlockStore()
    const pageId = 'page-keydel-text-frag'

    // 头块被裁的后缀里含 typed link（片段含完整链接语法，可被解析器匹配）
    const a = await store.createBlock({ pageId, content: 'head ((a<->b))[[X]] tail' })
    const b = await store.createBlock({ pageId, content: 'world' })

    const wrapper = mountBlockList(pageId)
    const selection = getSelection(wrapper)
    selection.startTextTracking({ blockId: a.id, offset: 5 }, { x: 0, y: 0 })
    selection.updateTextDrag({ blockId: b.id, offset: 1 })
    selection.finalizeTextDrag()

    const ev = dispatchDeleteKey('Backspace')
    await flushAsync()

    expect(ev.defaultPrevented).toBe(true)
    // 头块被裁后缀 '((a<->b))[[X]] tail' 作为消失片段进入目标提取（#100 前不接线，必不发生）
    expect(extractLinksSpy).toHaveBeenCalledWith('((a<->b))[[X]] tail')
    // 尾块被裁前缀同样进入
    expect(extractLinksSpy).toHaveBeenCalledWith('w')
    // 删除语义不回归：'head ' + 'orld' 拼接，尾块消失
    expect(store.blocks.find(x => x.id === a.id)?.content).toBe('head orld')
    expect(store.blocks.find(x => x.id === b.id)).toBeUndefined()

    wrapper.unmount()
  })
})

/**
 * D10 延伸落空的 mouseup 豁免：shift+click 延伸时若 head 无效（mousedown 直接
 * return），mouseup 不能落入「点击选区外清除」分支把既有选区清掉——文本选区
 * 激活时 anchorIds 必空（互斥），isInSelectedArea 恒 false，旧实现必清。
 * 夹具与删除键分派同法：mount + 文档级派发 + 经 provide 写入选区。
 */
describe('BlockList mouseup 清除豁免（D10：shift+click 延伸落空保住选区）', () => {
  let extractLinksSpy: MockInstance

  beforeEach(() => {
    setActivePinia(createPinia())
    extractLinksSpy = vi
      .spyOn(getCoreClient()!, 'extractLinksFromContent')
      .mockResolvedValue([])
  })

  afterEach(() => {
    extractLinksSpy.mockRestore()
  })

  function dispatchMouseUp(shiftKey: boolean): MouseEvent {
    const ev = new MouseEvent('mouseup', { bubbles: true, cancelable: true, shiftKey })
    document.body.dispatchEvent(ev)
    return ev
  }

  test('已有文本选区 + shift+mouseup（选区外）：选区保留', async () => {
    const store = useBlockStore()
    const pageId = 'page-mouseup-shift-keep'

    const a = await store.createBlock({ pageId, content: 'hello' })
    const b = await store.createBlock({ pageId, content: 'world' })

    const wrapper = mountBlockList(pageId)
    const selection = getSelection(wrapper)
    selection.startTextTracking({ blockId: a.id, offset: 1 }, { x: 0, y: 0 })
    selection.updateTextDrag({ blockId: b.id, offset: 2 })
    selection.finalizeTextDrag()
    expect(selection.textRange.value).not.toBeNull()

    // head 无效的延伸尝试：mousedown 在 lifecycle shift 分支 return（未动选区），
    // mouseup 落在选区外（body）——豁免分支应保住选区
    dispatchMouseUp(true)
    await flushAsync()

    expect(selection.textRange.value).not.toBeNull()

    wrapper.unmount()
  })

  test('已有文本选区 + 普通 mouseup（选区外）：照常清除（对照组，钉住豁免的区分力）', async () => {
    const store = useBlockStore()
    const pageId = 'page-mouseup-plain-clear'

    const a = await store.createBlock({ pageId, content: 'hello' })
    const b = await store.createBlock({ pageId, content: 'world' })

    const wrapper = mountBlockList(pageId)
    const selection = getSelection(wrapper)
    selection.startTextTracking({ blockId: a.id, offset: 1 }, { x: 0, y: 0 })
    selection.updateTextDrag({ blockId: b.id, offset: 2 })
    selection.finalizeTextDrag()

    dispatchMouseUp(false)
    await flushAsync()

    expect(selection.textRange.value).toBeNull()

    wrapper.unmount()
  })
})

/**
 * Ctrl+X 剪切分派：{文本选区, 块选区} × 剪切 = 先复制后删除（与 Backspace/Delete
 * 同一张分派表共用删除编排）。无选区时不接管（保留编辑器原生命中剪切）。
 * 剪贴板经 navigator.clipboard.writeText 替身观察（jsdom 无真实剪贴板；
 * ClipboardItem 未实现时 writeClipboardPayload 自动降级到 writeText 路径）。
 */
describe('BlockList 剪切键分派（Ctrl+X）', () => {
  let extractLinksSpy: MockInstance
  let writeTextMock: ReturnType<typeof vi.fn>
  let originalClipboard: PropertyDescriptor | undefined

  beforeEach(() => {
    setActivePinia(createPinia())
    extractLinksSpy = vi
      .spyOn(getCoreClient()!, 'extractLinksFromContent')
      .mockResolvedValue([])
    originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextMock },
    })
  })

  afterEach(() => {
    extractLinksSpy.mockRestore()
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard)
    } else {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    }
  })

  function dispatchCutKey(mods: { shift?: boolean; meta?: boolean } = {}): KeyboardEvent {
    const ev = new KeyboardEvent('keydown', {
      key: 'x',
      ctrlKey: !mods.meta,
      metaKey: !!mods.meta,
      shiftKey: !!mods.shift,
      bubbles: true,
      cancelable: true,
    })
    document.body.dispatchEvent(ev)
    return ev
  }

  test('文本选区 + Ctrl+X：复制切片文本到剪贴板 + 删除落库', async () => {
    const store = useBlockStore()
    const pageId = 'page-cut-text'

    const a = await store.createBlock({ pageId, content: 'hello' })
    const b = await store.createBlock({ pageId, content: 'world' })

    const wrapper = mountBlockList(pageId)
    const selection = getSelection(wrapper)
    selection.startTextTracking({ blockId: a.id, offset: 2 }, { x: 0, y: 0 })
    selection.updateTextDrag({ blockId: b.id, offset: 3 })
    selection.finalizeTextDrag()
    expect(selection.textRange.value).not.toBeNull()

    const ev = dispatchCutKey()
    await flushAsync()

    expect(ev.defaultPrevented).toBe(true)
    // 复制内容 = 首块后缀 + '\n' + 尾块前缀（textRangeToText 口径）
    expect(writeTextMock).toHaveBeenCalledWith('llo\nwor')
    // 删除语义与 Backspace 完全一致（同一分派表）
    expect(store.blocks.find(x => x.id === a.id)?.content).toBe('held')
    expect(store.blocks.find(x => x.id === b.id)).toBeUndefined()
    expect(selection.textRange.value).toBeNull()

    wrapper.unmount()
  })

  test('块选区 + Ctrl+X：复制块载荷纯文本 + 删除选中块', async () => {
    const store = useBlockStore()
    const pageId = 'page-cut-block'

    const keep = await store.createBlock({ pageId, content: 'keep' })
    const drop = await store.createBlock({ pageId, content: 'drop' })

    const wrapper = mountBlockList(pageId)
    const selection = getSelection(wrapper)
    selection.toggleBlock(drop.id, pageId)
    expect(selection.anchorIds.has(drop.id)).toBe(true)

    const ev = dispatchCutKey()
    await flushAsync()

    expect(ev.defaultPrevented).toBe(true)
    // payloadToPlainText 口径：顶层块按行拼接
    expect(writeTextMock).toHaveBeenCalledWith('drop')
    expect(store.blocks.find(x => x.id === drop.id)).toBeUndefined()
    expect(store.blocks.find(x => x.id === keep.id)).toBeDefined()

    wrapper.unmount()
  })

  test('无选区 + Ctrl+X：不接管（保留编辑器/浏览器原生命中剪切）', async () => {
    const store = useBlockStore()
    const pageId = 'page-cut-none'

    const a = await store.createBlock({ pageId, content: 'hello' })

    const wrapper = mountBlockList(pageId)
    const selection = getSelection(wrapper)
    expect(selection.textRange.value).toBeNull()

    const ev = dispatchCutKey()
    await flushAsync()

    expect(ev.defaultPrevented).toBe(false)
    expect(writeTextMock).not.toHaveBeenCalled()
    expect(store.blocks.find(x => x.id === a.id)?.content).toBe('hello')

    wrapper.unmount()
  })

  test('剪切时序钉子：writeText 永不 resolve，删除仍完成且剪贴板快照是删除前内容', async () => {
    const store = useBlockStore()
    const pageId = 'page-cut-ordering'

    const a = await store.createBlock({ pageId, content: 'hello' })
    const b = await store.createBlock({ pageId, content: 'world' })

    const wrapper = mountBlockList(pageId)
    const selection = getSelection(wrapper)
    selection.startTextTracking({ blockId: a.id, offset: 2 }, { x: 0, y: 0 })
    selection.updateTextDrag({ blockId: b.id, offset: 3 })
    selection.finalizeTextDrag()

    // 复制 promise 挂起不落：若实现错误地「先等复制完成再删除」，删除将永不发生
    writeTextMock.mockImplementation(() => new Promise(() => {}))

    const ev = dispatchCutKey()
    await flushAsync()

    expect(ev.defaultPrevented).toBe(true)
    // 快照在首个 await 前完成：即使复制未落盘，收到的也是删除前的选区文本
    expect(writeTextMock).toHaveBeenCalledWith('llo\nwor')
    // 删除不等复制：照常落库（与 Backspace 同一编排）
    expect(store.blocks.find(x => x.id === a.id)?.content).toBe('held')
    expect(store.blocks.find(x => x.id === b.id)).toBeUndefined()

    wrapper.unmount()
  })

  test('Cmd+X（metaKey）：与 Ctrl+X 同语义', async () => {
    const store = useBlockStore()
    const pageId = 'page-cut-meta'

    const a = await store.createBlock({ pageId, content: 'hello' })
    const b = await store.createBlock({ pageId, content: 'world' })

    const wrapper = mountBlockList(pageId)
    const selection = getSelection(wrapper)
    selection.startTextTracking({ blockId: a.id, offset: 1 }, { x: 0, y: 0 })
    selection.updateTextDrag({ blockId: b.id, offset: 2 })
    selection.finalizeTextDrag()

    const ev = dispatchCutKey({ meta: true })
    await flushAsync()

    expect(ev.defaultPrevented).toBe(true)
    expect(writeTextMock).toHaveBeenCalledWith('ello\nwo')
    // 头块前缀 'h' + 尾块后缀 'rld' = 'hrld'
    expect(store.blocks.find(x => x.id === a.id)?.content).toBe('hrld')
    expect(store.blocks.find(x => x.id === b.id)).toBeUndefined()

    wrapper.unmount()
  })

  test('Ctrl+Shift+X：不在剪切的字面授权内，不接管（选区保留）', async () => {
    const store = useBlockStore()
    const pageId = 'page-cut-shift-x'

    const a = await store.createBlock({ pageId, content: 'hello' })
    const b = await store.createBlock({ pageId, content: 'world' })

    const wrapper = mountBlockList(pageId)
    const selection = getSelection(wrapper)
    selection.startTextTracking({ blockId: a.id, offset: 1 }, { x: 0, y: 0 })
    selection.updateTextDrag({ blockId: b.id, offset: 2 })
    selection.finalizeTextDrag()
    expect(selection.textRange.value).not.toBeNull()

    const ev = dispatchCutKey({ shift: true })
    await flushAsync()

    expect(ev.defaultPrevented).toBe(false)
    expect(writeTextMock).not.toHaveBeenCalled()
    expect(selection.textRange.value).not.toBeNull()
    expect(store.blocks.find(x => x.id === a.id)?.content).toBe('hello')
    expect(store.blocks.find(x => x.id === b.id)?.content).toBe('world')

    wrapper.unmount()
  })
})
