/**
 * BlockList document 级编排回归网（#92）
 *
 * 与 `BlockList.keyboard-delete.test.ts`（#95/#96 删除键分派）、
 * `BlockList.paste-guard.test.ts`（KeepAlive 粘贴归属守卫）同夹具同口径：
 * `mount(BlockList)` + document 级派发 + 经组件自身 provide 的 `crossBlockSelection`
 * 写读选区状态，断言落在真实 store 结果上（不 mock 编排层）。
 *
 * 本文件补齐 #92 验收线剩余三项：
 * 1. 手势——单击 vs 拖拽（4px 阈值）、内容区起点（文本拖拽）vs 属性区起点（块选区）；
 * 2. 按键分发——`Ctrl+A`（捕获阶段 + body 焦点回退）/ `Ctrl+C`（文本选区优先）/
 *    `Enter`、`Tab`、`Shift+Tab`（仅无编辑态块）/ `Escape`；
 * 3. 粘贴分发——内部 MIME / 外部源拆分 / Shift+V 纯文本标志消费（归属守卫见 paste-guard）。
 *
 * 几何替身（必要）：`handleDocMouseMove` 经 `blockOffsetFromPoint` 调
 * `document.elementFromPoint` + `document.caretRangeFromPoint`，jsdom 两个都没实现
 * （探测确认为 undefined，调用即 TypeError）。这里注入「行带屏幕模型」：每个顶层块
 * 占 30px 高的一条行带，y 定位块、x 定位字符偏移（10px/字符）。
 * 与 `selection-geometry.test.ts` 的 `Range.getClientRects` 替身同法——被测的不是像素，
 * 而是「哪个块、哪个偏移、走哪条分支」。
 *
 * 唯一被替换的原语：`getCoreClient().extractLinksFromContent`（jsdom 下 WasmClientAdapter
 * 硬编码 throw，既存环境局限）。`ensureWikiLinkTargets` / `notifyCreatedPages` 被 mock
 * 成 spy（外呼依赖），其被调用与否本身就是粘贴分发的证据。
 */
import { describe, test, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import BlockList from './BlockList.vue'
import { useBlockStore } from '../stores/blocks'
import { useEditorStore } from '../stores/editor'
import { getCoreClient } from '../wasm/client'
import { COMIND_BLOCK_MIME } from '../services/external-paste-parse'
import { sortByDocumentOrderIds } from '../utils/block-helpers'
import type { CrossBlockSelection } from '../composables/useCrossBlockSelection'

const { ensureSpy, notifySpy } = vi.hoisted(() => ({
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

// ── 几何替身（行带屏幕模型） ────────────────────────────────────────

/** 每块行高（px） */
const ROW_H = 30
/** 行内每字符宽度（px），用于把 x 换算成 block 内字符偏移 */
const CHAR_W = 10
/** 行带左原点 */
const X0 = 0

let rows: HTMLElement[] = []
let savedElementFromPoint: PropertyDescriptor | undefined
let savedCaretRangeFromPoint: PropertyDescriptor | undefined
let savedGetClientRects: PropertyDescriptor | undefined

function rowIndexOf(blockId: string): number {
  const i = rows.findIndex(el => el.dataset.blockId === blockId)
  if (i < 0) throw new Error(`屏幕模型未登记块 ${blockId}（未渲染或嵌套？）`)
  return i
}

/** 取某块行带内的屏幕坐标；`xInRow` 决定字符偏移（0 → 行首） */
function pointAt(blockId: string, xInRow = 0): { x: number; y: number } {
  return { x: X0 + xInRow, y: rowIndexOf(blockId) * ROW_H + ROW_H / 2 }
}

function blockEl(blockId: string): HTMLElement {
  return rows[rowIndexOf(blockId)]
}

/** 取块内容区第一个文本节点（`.block-content` 内的渲染文本） */
function firstTextNodeOf(el: HTMLElement): Text | null {
  const root = el.querySelector('.block-content') ?? el
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  return walker.nextNode() as Text | null
}

function installGeometryShim(): void {
  savedElementFromPoint = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')
  savedCaretRangeFromPoint = Object.getOwnPropertyDescriptor(document, 'caretRangeFromPoint')

  // 文本选区一建立就会触发覆盖层高亮 watcher → selectionClientRects 调 Range.getClientRects，
  // jsdom 原型上没有该方法（未处理拒绝会污染整个文件）。本文件不验高亮几何，空矩形即可。
  savedGetClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    writable: true,
    value: () => [],
  })

  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    writable: true,
    value: (_x: number, y: number): Element | null => {
      if (y < 0) return null
      return rows[Math.floor(y / ROW_H)] ?? null
    },
  })

  Object.defineProperty(document, 'caretRangeFromPoint', {
    configurable: true,
    writable: true,
    value: (x: number, y: number): Range | null => {
      const el = y < 0 ? null : rows[Math.floor(y / ROW_H)]
      if (!el) return null
      const text = firstTextNodeOf(el)
      if (!text) return null
      const offset = Math.max(0, Math.min(Math.round((x - X0) / CHAR_W), text.length))
      const range = document.createRange()
      range.setStart(text, offset)
      range.setEnd(text, offset)
      return range
    },
  })
}

function restoreGeometryShim(): void {
  if (savedGetClientRects) Object.defineProperty(Range.prototype, 'getClientRects', savedGetClientRects)
  else delete (Range.prototype as unknown as Record<string, unknown>).getClientRects

  for (const [name, saved] of [
    ['elementFromPoint', savedElementFromPoint],
    ['caretRangeFromPoint', savedCaretRangeFromPoint],
  ] as const) {
    if (saved) Object.defineProperty(document, name, saved)
    else delete (document as unknown as Record<string, unknown>)[name]
  }
}

// ── 夹具 ──────────────────────────────────────────────────────────

const stubGlobal = {
  stubs: {
    VueDraggable: { template: '<div><slot /></div>' },
    BlockDropIndicator: true,
  },
}

async function mountBlockList(pageId: string): Promise<VueWrapper> {
  const wrapper = mount(BlockList, {
    props: { pageId },
    attachTo: document.body,
    global: stubGlobal,
  })
  // tree 在父组件 onMounted 里由 store 构建，子列表经 defineModel 接收 →
  // 必须等一次 tick 子组件才拿到列表并渲染出块
  await nextTick()
  // 只登记顶层块（嵌套块的坐标由行带模型简化掉，本文件夹具全为平铺）
  rows = Array.from(wrapper.element.querySelectorAll<HTMLElement>('[data-block-id]'))
    .filter(el => !el.parentElement?.closest('[data-block-id]'))
  return wrapper
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

function dispatchMouse(type: 'mousedown' | 'mousemove' | 'mouseup', target: EventTarget, x: number, y: number, shiftKey = false): MouseEvent {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, shiftKey })
  target.dispatchEvent(ev)
  return ev
}

function dispatchKey(key: string, mods: { ctrl?: boolean; shift?: boolean } = {}, target: EventTarget = document.body): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', {
    key,
    ctrlKey: !!mods.ctrl,
    shiftKey: !!mods.shift,
    bubbles: true,
    cancelable: true,
  })
  target.dispatchEvent(ev)
  return ev
}

/** jsdom ClipboardEvent 构造器不支持 clipboardData（先例：paste-guard） */
function makePasteEvent(map: Record<string, string>): ClipboardEvent {
  const ev = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(ev, 'clipboardData', {
    value: {
      getData: (type: string) => map[type] ?? '',
      types: Object.keys(map),
    },
  })
  return ev
}

async function flushAsync() {
  await flushPromises()
  await new Promise(r => setTimeout(r, 0))
  await flushPromises()
}

/** 页面内块的文档序 id 列表 */
function docOrder(pageId: string): string[] {
  const store = useBlockStore()
  const ids = store.blocks.filter(b => b.pageId === pageId).map(b => b.id)
  return sortByDocumentOrderIds(ids, store.blocks)
}

let extractLinksSpy: MockInstance

beforeEach(() => {
  setActivePinia(createPinia())
  ensureSpy.mockClear()
  notifySpy.mockClear()
  extractLinksSpy = vi
    .spyOn(getCoreClient()!, 'extractLinksFromContent')
    .mockResolvedValue([])
  installGeometryShim()
})

afterEach(() => {
  extractLinksSpy.mockRestore()
  restoreGeometryShim()
  rows = []
})

// ══════════════════════════════════════════════════════════════════
// 一、手势
// ══════════════════════════════════════════════════════════════════

describe('BlockList 手势编排（#92）', () => {
  test('内容区起点 + 位移 < 4px：仍是单击（不进拖拽、不失活编辑器）', async () => {
    const store = useBlockStore()
    const editor = useEditorStore()
    const pageId = 'page-gesture-threshold'

    const a = await store.createBlock({ pageId, content: 'hello' })

    const wrapper = await mountBlockList(pageId)
    const selection = getSelection(wrapper)
    editor.activateBlock(a.id)

    const p = pointAt(a.id, 0)
    dispatchMouse('mousedown', blockEl(a.id).querySelector('.block-content')!, p.x, p.y)
    expect(selection.textDragAnchor.value?.blockId).toBe(a.id)
    expect(selection.isTextDragging.value).toBe(false)

    // 位移 3px（< 阈值 4px）：不得进入拖拽
    dispatchMouse('mousemove', document, p.x + 3, p.y)
    expect(selection.isTextDragging.value).toBe(false)
    expect(selection.textRange.value).toBeNull()
    expect(editor.activeBlockId).toBe(a.id)

    // 单击语义收尾：mouseup 清追踪并激活该块编辑器
    dispatchMouse('mouseup', blockEl(a.id).querySelector('.block-content')!, p.x + 3, p.y)
    expect(selection.textDragAnchor.value).toBeNull()
    expect(editor.activeBlockId).toBe(a.id)

    wrapper.unmount()
  })

  test('内容区起点 + 位移 ≥ 4px：进入文本拖拽并实时更新 head（失活编辑器）', async () => {
    const store = useBlockStore()
    const editor = useEditorStore()
    const pageId = 'page-gesture-textdrag'

    const a = await store.createBlock({ pageId, content: 'hello' })
    const b = await store.createBlock({ pageId, content: 'world' })

    const wrapper = await mountBlockList(pageId)
    const selection = getSelection(wrapper)
    editor.activateBlock(a.id)

    const p = pointAt(a.id, 0)
    dispatchMouse('mousedown', blockEl(a.id).querySelector('.block-content')!, p.x, p.y)
    expect(selection.textDragAnchor.value).toEqual({ blockId: a.id, offset: 0 })

    // 位移 30px（≥ 阈值）+ 落在 b 行带：head 跟到 b 内偏移
    const q = pointAt(b.id, 20)
    dispatchMouse('mousemove', document, q.x, q.y)

    expect(selection.isTextDragging.value).toBe(true)
    // 拖拽接管即失活编辑器（PM 挂载与 comind 文本选区不并存）
    expect(editor.activeBlockId).toBeNull()
    const range = selection.textRange.value
    expect(range?.anchor).toEqual({ blockId: a.id, offset: 0 })
    expect(range?.head).toEqual({ blockId: b.id, offset: 2 })

    // mouseup 固化：拖拽态清空、选区保留
    dispatchMouse('mouseup', document, q.x, q.y)
    expect(selection.isTextDragging.value).toBe(false)
    expect(selection.textRange.value).not.toBeNull()

    wrapper.unmount()
  })

  test('属性区起点：建立块选区追踪（不做文本拖拽），拖到另一块后固化', async () => {
    const store = useBlockStore()
    const pageId = 'page-gesture-blockdrag'

    const a = await store.createBlock({ pageId, content: 'aaa' })
    const b = await store.createBlock({ pageId, content: 'bbb' })

    const wrapper = await mountBlockList(pageId)
    const selection = getSelection(wrapper)

    dispatchMouse('mousedown', blockEl(a.id).querySelector('.block-properties')!, 0, 0)

    // 起点区分：属性区起点 → 块选区追踪，无文本拖拽锚点
    expect(selection.dragStartBlockId.value).toBe(a.id)
    expect(selection.trackingFromProperty.value).toBe(true)
    expect(selection.textDragAnchor.value).toBeNull()

    const q = pointAt(b.id)
    dispatchMouse('mousemove', document, q.x, q.y)
    expect(selection.isDragging.value).toBe(true)
    expect(Array.from(selection.selectedIds).sort()).toEqual([a.id, b.id].sort())

    // 固化：拖拽中的 selectedIds 让位给 committed anchorIds
    dispatchMouse('mouseup', blockEl(b.id).querySelector('.block-properties')!, q.x, q.y)
    expect(selection.isDragging.value).toBe(false)
    expect(Array.from(selection.anchorIds).sort()).toEqual([a.id, b.id].sort())
    expect(Array.from(selection.selectedIds)).toEqual([])

    wrapper.unmount()
  })

  test('属性区起点单击（未拖）：清追踪但【不】激活编辑器；内容区起点单击则激活（D6 区分）', async () => {
    const store = useBlockStore()
    const editor = useEditorStore()
    const pageId = 'page-gesture-singleclick'

    const a = await store.createBlock({ pageId, content: 'aaa' })

    const wrapper = await mountBlockList(pageId)

    // 属性区起点 → 单击不激活（属性区只做块选区）
    dispatchMouse('mousedown', blockEl(a.id).querySelector('.block-properties')!, 0, 0)
    dispatchMouse('mouseup', blockEl(a.id).querySelector('.block-properties')!, 0, 0)
    expect(editor.activeBlockId).toBeNull()

    // 内容区起点 → 单击激活编辑器（对照组，钉住两条起点的语义差）
    const p = pointAt(a.id, 0)
    dispatchMouse('mousedown', blockEl(a.id).querySelector('.block-content')!, p.x, p.y)
    dispatchMouse('mouseup', blockEl(a.id).querySelector('.block-content')!, p.x, p.y)
    expect(editor.activeBlockId).toBe(a.id)

    wrapper.unmount()
  })
})

// ══════════════════════════════════════════════════════════════════
// 二、按键分发
// ══════════════════════════════════════════════════════════════════

describe('BlockList Ctrl+A 捕获分派（#92）', () => {
  test('块内上下文（激活块内）+ Ctrl+A：捕获阶段拦截并全选本页块（阻止浏览器整页全选）', async () => {
    const store = useBlockStore()
    const editor = useEditorStore()
    const pageId = 'page-ctrla-inblock'

    const a = await store.createBlock({ pageId, content: 'aaa' })
    const b = await store.createBlock({ pageId, content: 'bbb' })

    const wrapper = await mountBlockList(pageId)
    const selection = getSelection(wrapper)
    // 激活块：Ctrl+A 的接管条件之一（激活块 / 块选区 / 属性区），也是真实上下文
    editor.activateBlock(a.id)
    await nextTick()

    const contentEl = blockEl(a.id).querySelector('.block-content')!
    const ev = dispatchKey('a', { ctrl: true }, contentEl)

    expect(ev.defaultPrevented).toBe(true)
    expect(Array.from(selection.anchorIds).sort()).toEqual([a.id, b.id].sort())

    wrapper.unmount()
  })

  test('焦点已落回 body（点击属性区后）：回退最近点击上下文，仍全选', async () => {
    const store = useBlockStore()
    const pageId = 'page-ctrla-bodyfallback'

    const a = await store.createBlock({ pageId, content: 'aaa' })
    const b = await store.createBlock({ pageId, content: 'bbb' })

    const wrapper = await mountBlockList(pageId)
    const selection = getSelection(wrapper)

    // 属性区/bullet 不可聚焦 → 点击后焦点落回 body；mouseup 记录 lastClicked* 供回退
    dispatchMouse('mouseup', blockEl(a.id).querySelector('.block-properties')!, 0, 0)
    expect(document.activeElement).not.toBe(blockEl(a.id))

    const ev = dispatchKey('a', { ctrl: true }, document.body)

    expect(ev.defaultPrevented).toBe(true)
    expect(Array.from(selection.anchorIds).sort()).toEqual([a.id, b.id].sort())

    wrapper.unmount()
  })

  test('上下文不在 BlockList（树外元素）：不接管（交 App.vue 全局兜底）', async () => {
    const store = useBlockStore()
    const pageId = 'page-ctrla-outside'

    await store.createBlock({ pageId, content: 'aaa' })

    const wrapper = await mountBlockList(pageId)
    const selection = getSelection(wrapper)

    const outside = document.createElement('div')
    document.body.appendChild(outside)

    const ev = dispatchKey('a', { ctrl: true }, outside)

    expect(ev.defaultPrevented).toBe(false)
    expect(selection.anchorIds.size).toBe(0)

    outside.remove()
    wrapper.unmount()
  })
})

describe('BlockList Ctrl+C 分派（#92）', () => {
  let writeTextMock: ReturnType<typeof vi.fn>
  let originalClipboard: PropertyDescriptor | undefined

  beforeEach(() => {
    originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextMock },
    })
  })

  afterEach(() => {
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
    else Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
  })

  /** 两类选区互斥，故「文本优先」体现为两条分支各走其复制口径 */
  test('文本选区 + Ctrl+C：复制切片文本（文本口径优先于块口径）', async () => {
    const store = useBlockStore()
    const pageId = 'page-ctrlc-text'

    const a = await store.createBlock({ pageId, content: 'hello' })
    const b = await store.createBlock({ pageId, content: 'world' })

    const wrapper = await mountBlockList(pageId)
    const selection = getSelection(wrapper)
    selection.startTextTracking({ blockId: a.id, offset: 2 }, { x: 0, y: 0 })
    selection.updateTextDrag({ blockId: b.id, offset: 3 })
    selection.finalizeTextDrag()

    const ev = dispatchKey('c', { ctrl: true })
    await flushAsync()

    expect(ev.defaultPrevented).toBe(true)
    expect(writeTextMock).toHaveBeenCalledWith('llo\nwor')
    // 复制不改选区、不落库
    expect(selection.textRange.value).not.toBeNull()
    expect(store.blocks.find(x => x.id === b.id)).toBeDefined()

    wrapper.unmount()
  })

  test('块选区 + Ctrl+C：复制块载荷纯文本（走块口径）', async () => {
    const store = useBlockStore()
    const pageId = 'page-ctrlc-block'

    const a = await store.createBlock({ pageId, content: 'payload-a' })
    await store.createBlock({ pageId, content: 'bbb' })

    const wrapper = await mountBlockList(pageId)
    const selection = getSelection(wrapper)
    selection.toggleBlock(a.id, pageId)

    const ev = dispatchKey('c', { ctrl: true })
    await flushAsync()

    expect(ev.defaultPrevented).toBe(true)
    expect(writeTextMock).toHaveBeenCalledWith('payload-a')

    wrapper.unmount()
  })

  test('无选区 + Ctrl+C：不接管（交还浏览器原生复制）', async () => {
    const store = useBlockStore()
    const pageId = 'page-ctrlc-none'

    await store.createBlock({ pageId, content: 'aaa' })

    const wrapper = await mountBlockList(pageId)

    const ev = dispatchKey('c', { ctrl: true })
    await flushAsync()

    expect(ev.defaultPrevented).toBe(false)
    expect(writeTextMock).not.toHaveBeenCalled()

    wrapper.unmount()
  })
})

describe('BlockList Escape / Enter / Tab 分派（#92）', () => {
  test('Escape：清块选区与文本选区两类', async () => {
    const store = useBlockStore()
    const pageId = 'page-escape'

    const a = await store.createBlock({ pageId, content: 'aaa' })
    const b = await store.createBlock({ pageId, content: 'bbb' })

    const wrapper = await mountBlockList(pageId)
    const selection = getSelection(wrapper)

    selection.startTextTracking({ blockId: a.id, offset: 0 }, { x: 0, y: 0 })
    selection.updateTextDrag({ blockId: b.id, offset: 1 })
    selection.finalizeTextDrag()
    expect(selection.textRange.value).not.toBeNull()

    dispatchKey('Escape')
    expect(selection.textRange.value).toBeNull()

    selection.toggleBlock(a.id, pageId)
    expect(selection.anchorIds.size).toBe(1)

    dispatchKey('Escape')
    expect(selection.anchorIds.size).toBe(0)

    wrapper.unmount()
  })

  test('Enter：选中无编辑态块（image）→ 在其上方插入新块并聚焦', async () => {
    const store = useBlockStore()
    const editor = useEditorStore()
    const pageId = 'page-enter-image'

    // image 块 content = 图片 markdown（ImageRender 口径），非空才走「行首 → 上方插入」
    const img = await store.createBlock({ pageId, content: '![alt](asset://img-1)', type: 'image' })
    const txt = await store.createBlock({ pageId, content: 'tail' })
    expect(docOrder(pageId)).toEqual([img.id, txt.id])

    const wrapper = await mountBlockList(pageId)
    const selection = getSelection(wrapper)
    selection.toggleBlock(img.id, pageId)

    const ev = dispatchKey('Enter')
    await flushAsync()

    expect(ev.defaultPrevented).toBe(true)
    const order = docOrder(pageId)
    expect(order).toHaveLength(3)
    // 新块落在 image 之前，其余块序不变
    const newId = order.find(id => id !== img.id && id !== txt.id)!
    expect(order.indexOf(newId)).toBe(order.indexOf(img.id) - 1)
    expect(order.indexOf(txt.id)).toBeGreaterThan(order.indexOf(img.id))
    // 选区让位给新块编辑态
    expect(selection.anchorIds.size).toBe(0)
    expect(editor.activeBlockId).toBe(newId)

    wrapper.unmount()
  })

  test('Enter：选中普通文本块 → 不接管（保留编辑器自身的 Enter 语义）', async () => {
    const store = useBlockStore()
    const pageId = 'page-enter-bullet'

    const a = await store.createBlock({ pageId, content: 'plain' })
    const before = docOrder(pageId)

    const wrapper = await mountBlockList(pageId)
    const selection = getSelection(wrapper)
    selection.toggleBlock(a.id, pageId)

    const ev = dispatchKey('Enter')
    await flushAsync()

    expect(ev.defaultPrevented).toBe(false)
    expect(docOrder(pageId)).toEqual(before)

    wrapper.unmount()
  })

  test('Tab / Shift+Tab：选中无编辑态块（image）→ 缩进与反缩进', async () => {
    const store = useBlockStore()
    const pageId = 'page-tab-image'

    const parent = await store.createBlock({ pageId, content: 'parent' })
    // image 块 content = 图片 markdown（ImageRender 口径），非空才走「行首 → 上方插入」
    const img = await store.createBlock({ pageId, content: '![alt](asset://img-1)', type: 'image' })

    const wrapper = await mountBlockList(pageId)
    const selection = getSelection(wrapper)
    selection.toggleBlock(img.id, pageId)

    const tabEv = dispatchKey('Tab')
    await flushAsync()
    expect(tabEv.defaultPrevented).toBe(true)
    expect(store.blocks.find(b => b.id === img.id)?.parentId).toBe(parent.id)

    // 缩进后选区仍在 image 上（分派不消费选区）
    const shiftTabEv = dispatchKey('Tab', { shift: true })
    await flushAsync()
    expect(shiftTabEv.defaultPrevented).toBe(true)
    expect(store.blocks.find(b => b.id === img.id)?.parentId).toBeNull()

    wrapper.unmount()
  })

  test('Tab：选中普通文本块 → 不接管（保留编辑器自身缩进语义）', async () => {
    const store = useBlockStore()
    const pageId = 'page-tab-bullet'

    const parent = await store.createBlock({ pageId, content: 'parent' })
    const child = await store.createBlock({ pageId, content: 'plain' })

    const wrapper = await mountBlockList(pageId)
    const selection = getSelection(wrapper)
    selection.toggleBlock(child.id, pageId)

    const ev = dispatchKey('Tab')
    await flushAsync()

    expect(ev.defaultPrevented).toBe(false)
    expect(store.blocks.find(b => b.id === child.id)?.parentId).toBeNull()
    expect(store.blocks.find(b => b.id === parent.id)).toBeDefined()

    wrapper.unmount()
  })
})

// ══════════════════════════════════════════════════════════════════
// 三、粘贴分发（归属守卫见 BlockList.paste-guard.test.ts）
// ══════════════════════════════════════════════════════════════════

describe('BlockList 粘贴分发（#92）', () => {
  /** 内部 MIME 载荷（block-clipboard 口径） */
  function internalPayload(content: string): string {
    return JSON.stringify({
      version: 1,
      kind: 'blocks',
      blocks: [{ content, type: 'bullet', format: null, properties: null, children: [] }],
    })
  }

  test('内部 MIME → 走块级粘贴（pasteBlocks），不进外部解析', async () => {
    const store = useBlockStore()
    const pageId = 'page-paste-internal'

    const a = await store.createBlock({ pageId, content: 'anchor' })

    const wrapper = await mountBlockList(pageId)
    const selection = getSelection(wrapper)
    selection.toggleBlock(a.id, pageId)

    const ev = makePasteEvent({
      [COMIND_BLOCK_MIME]: internalPayload('内部块'),
      'text/plain': '内部块',
    })
    blockEl(a.id).dispatchEvent(ev)
    await flushAsync()

    expect(ev.defaultPrevented).toBe(true)
    expect(store.blocks.some(b => b.pageId === pageId && b.content === '内部块')).toBe(true)
    expect(ensureSpy).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })

  test('外部源（text/html）→ 拆分多块落库', async () => {
    const store = useBlockStore()
    const pageId = 'page-paste-external'

    const a = await store.createBlock({ pageId, content: 'anchor' })

    const wrapper = await mountBlockList(pageId)
    const selection = getSelection(wrapper)
    selection.toggleBlock(a.id, pageId)

    const ev = makePasteEvent({
      'text/html': '<h2>外部标题</h2><p>外部段落</p>',
      'text/plain': '外部标题\n外部段落',
    })
    blockEl(a.id).dispatchEvent(ev)
    await flushAsync()

    expect(ev.defaultPrevented).toBe(true)
    const contents = store.blocks.filter(b => b.pageId === pageId).map(b => b.content)
    expect(contents).toContain('## 外部标题')
    expect(contents).toContain('外部段落')

    wrapper.unmount()
  })

  test('外部源 + 行内光标（编辑区有文本、无选区）→ 放行给 TipTap 单块粘贴', async () => {
    const store = useBlockStore()
    const pageId = 'page-paste-inline'

    const a = await store.createBlock({ pageId, content: 'anchor' })
    const before = docOrder(pageId)

    const wrapper = await mountBlockList(pageId)

    // 行内光标上下文：目标在 contenteditable 内且编辑区有文本
    // （`.ProseMirror` 不被 isInEditableInput 豁免，正是该分支的可达形状）
    const pm = document.createElement('div')
    pm.className = 'ProseMirror'
    pm.setAttribute('contenteditable', 'true')
    pm.textContent = 'inline'
    blockEl(a.id).querySelector('.block-content')!.appendChild(pm)

    const ev = makePasteEvent({
      'text/html': '<p>不该落成块</p>',
      'text/plain': '不该落成块',
    })
    pm.dispatchEvent(ev)
    await flushAsync()

    expect(ev.defaultPrevented).toBe(false)
    // 放行路径不落块；ensure 走 fire-and-forget（[[目标]] 声明仍需建页）
    expect(docOrder(pageId)).toEqual(before)
    expect(ensureSpy).toHaveBeenCalledTimes(1)

    pm.remove()
    wrapper.unmount()
  })

  test('外部源 + 空编辑区（行内光标判定为假）→ 视为块级上下文，接管并落块', async () => {
    const store = useBlockStore()
    const pageId = 'page-paste-emptycaret'

    const a = await store.createBlock({ pageId, content: 'anchor' })

    const wrapper = await mountBlockList(pageId)
    const selection = getSelection(wrapper)
    selection.toggleBlock(a.id, pageId)

    const pm = document.createElement('div')
    pm.className = 'ProseMirror'
    pm.setAttribute('contenteditable', 'true')
    // 空编辑区 → isInlineCaretContext 假
    blockEl(a.id).querySelector('.block-content')!.appendChild(pm)

    const ev = makePasteEvent({
      'text/html': '<p>空块上的外部粘贴</p>',
      'text/plain': '空块上的外部粘贴',
    })
    pm.dispatchEvent(ev)
    await flushAsync()

    expect(ev.defaultPrevented).toBe(true)
    expect(store.blocks.some(b => b.pageId === pageId && b.content === '空块上的外部粘贴')).toBe(true)

    pm.remove()
    wrapper.unmount()
  })

  test('Shift+V 标志：消费一次即复位，不污染下一次普通粘贴', async () => {
    const store = useBlockStore()
    const pageId = 'page-paste-shiftv'

    const a = await store.createBlock({ pageId, content: 'anchor' })

    const wrapper = await mountBlockList(pageId)
    const selection = getSelection(wrapper)
    selection.toggleBlock(a.id, pageId)
    const before = docOrder(pageId)

    // Ctrl+Shift+V 置标志（keydown 在 body 上，焦点丢失场景）
    dispatchKey('v', { ctrl: true, shift: true }, document.body)

    const shiftEv = makePasteEvent({
      'text/html': '<p>纯文本放行</p>',
      'text/plain': '纯文本放行',
    })
    blockEl(a.id).dispatchEvent(shiftEv)
    await flushAsync()

    // D9：Shift+V 放行（交还默认行为），不落块
    expect(shiftEv.defaultPrevented).toBe(false)
    expect(docOrder(pageId)).toEqual(before)

    // 标志已消费：同一目标的下一次普通粘贴照常走块级分发
    const plainEv = makePasteEvent({
      'text/html': '<p>普通粘贴</p>',
      'text/plain': '普通粘贴',
    })
    blockEl(a.id).dispatchEvent(plainEv)
    await flushAsync()

    expect(plainEv.defaultPrevented).toBe(true)
    expect(store.blocks.some(b => b.pageId === pageId && b.content === '普通粘贴')).toBe(true)

    wrapper.unmount()
  })

  test('非 Ctrl+V 键击复位 Shift+V 标志：Shift+V 后按普通键，粘贴回到块级分发', async () => {
    const store = useBlockStore()
    const pageId = 'page-paste-flagreset'

    const a = await store.createBlock({ pageId, content: 'anchor' })

    const wrapper = await mountBlockList(pageId)
    const selection = getSelection(wrapper)
    selection.toggleBlock(a.id, pageId)

    dispatchKey('v', { ctrl: true, shift: true }, document.body)
    // 任意非 Ctrl+V 键击清标志（避免 keydown 后 paste 未触发导致残留污染）
    dispatchKey('Escape', {}, document.body)

    const ev = makePasteEvent({
      'text/html': '<p>复位后再粘贴</p>',
      'text/plain': '复位后再粘贴',
    })
    blockEl(a.id).dispatchEvent(ev)
    await flushAsync()

    expect(ev.defaultPrevented).toBe(true)
    expect(store.blocks.some(b => b.pageId === pageId && b.content === '复位后再粘贴')).toBe(true)

    wrapper.unmount()
  })
})
