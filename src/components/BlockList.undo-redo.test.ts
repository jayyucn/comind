/**
 * BlockList 撤销历史栈集成回归网（ADR-0046 T5 / #110）
 *
 * 覆盖 #103 验收门禁的行为侧：任何焦点下 `Ctrl+Z` 语义稳定、不出现「撤销穿越焦点」、
 * 视图噪声不进栈。夹具与口径照 `BlockList.keyboard-delete.test.ts`（#95/#96）与
 * `BlockList.selection-orchestration.test.ts`（#92）：`mount(BlockList)` + document 级
 * 派发 + 经组件自身 provide 的 `crossBlockSelection` 读写选区，断言落在真实 store 结果上
 * —— 不 mock 编排层，也不 mock wasm client（jsdom 走 WasmClientAdapter，恢复经 `executeBatch`
 * 单事务真实现；`undelete` 已作为该事务内的 op，独立 `undeleteBlocks` 原语保留供回收站复用）。
 *
 * 六处必要替身（皆为 jsdom 能力缺口，非本功能问题）：
 * 1. `window.matchMedia`：import 链中模块级求值会调用（先例：TaskHub.test.ts）。
 * 2. `Range.prototype.getClientRects`：块选区一建立就触发高亮层 watcher，jsdom 无此方法
 *    （同 #92，空矩形即可 —— 本文件不验像素）。
 * 3. `Range.prototype.getBoundingClientRect` 与 `Node.prototype.getBoundingClientRect`：撤销/重做
 *    **落点会激活块**（`activateBlock` → `focusActiveEditor`），于是真挂 TipTap —— ProseMirror 的
 *    `coordsAtPos` 会把文本节点包成 Range 交给 `singleRect`：先 `getClientRects()`（替身 2 已给）、
 *    空则回落到 `getBoundingClientRect()`，而 jsdom 的 Range / Text 都没实现。
 * 4. `document.elementFromPoint`：落点激活块后 `focusActiveEditor` 的「点击坐标」分支会调
 *    `Editor.focusAtCoords` → PM `posAtCoords`。恒 null ⇒ PM 判定坐标不在框内 ⇒ 回落 `focus('end')`。
 * 5. `Element.prototype.scrollIntoView`（在「滚入视野」与「可见性门控」两例内局部装/还原）：jsdom 未实现，
 *    而产品侧有 `typeof` 守卫会静默跳过 —— 不装替身就**无法**证明「滚 / 不滚的是光标落点那块」。
 * 6. 「编辑态焦点」用注入的合成元素（`div.ProseMirror[contenteditable]` / CodeMirror 形状）
 *    而非真挂 TipTap/CodeMirror —— 本票验的是**按键路由**；「禁用内置历史」由 #109 在
 *    `Editor.vue`（`undoRedo:false`）与 `CodeMirrorEditor.vue`（去 `history()`+`historyKeymap`）
 *    单独钉过，重复挂真编辑器只会引入 jsdom 脆弱性而不增加信号。
 * 7. 「墨迹」替身（`stubInkRects`，**逐例**装 / 还原）：落点闪烁量的是区域内**文本节点**的
 *    `Range.getClientRects`，而 jsdom 无布局 ⇒ 恒空 ⇒ 生产侧判定「无墨迹 ⇒ 不闪」。不装替身，
 *    G 组的闪烁断言就无从成立 —— 替身把「哪一块、哪个区域」编码进假矩形，见其注释。
 *
 * 已知未覆盖（有意，附理由 —— 别当漏项补）：
 * - `runUndoRedo` 的**退出编辑态**那一步（`deactivateBlock()` + `nextTick()`，借 Editor 卸载时
 *   `onBeforeUnmount` 同步那段未落库文本）在本网**没有等价断言**：要断言它必须先在**真编辑态**里
 *   打字（合成按键到不了 TipTap 的 onUpdate），而真挂之后 Editor 卸载会把**它自己那份 stale 内容**
 *   写回 store、绕过撤销 —— 断言会变假绿。故本网只从**边界侧**钉住该守卫（见 D 组「编辑态落在
 *   别页块上」），该步交真机复核。（注意：落点那一侧现在**确实**会真挂 TipTap，见替身 3/4 ——
 *   未覆盖的只是「退出编辑态」，不是「挂编辑器」。）
 * - 落点的**像素表现**（矩形落在哪一像素、动画是否淡出）不在本网：只验 `.restore-flash-rect`
 *   的建立（数量 + 来源编码）与到期清空 —— 淡出是 CSS 动画，jsdom 不跑动画。视觉由真机复核。
 * - 落点块**在折叠祖先之下**（例：BlockModal 里改了折叠子树内的块）时，主列表里它不渲染 ⇒
 *   量不出矩形、光标也落不进去（`activeBlockId` 仍会被设为该块，与方向键导航同口径）。
 *   产品侧有意不兜底（见 `BlockList.vue` `landOnChangedBlocks` 注释）；故本网只覆盖可见块。
 * - **编辑态块的内容区在 jsdom 里量不出墨迹**：落点总会把目标块切进编辑态，而真挂的 TipTap 内部
 *   在本网按零矩形处理（替身 2/3），jsdom 也没把它的文本渲染出来 ⇒ G 组用 `inkInProperties` 给
 *   目标块的属性带造墨迹。「编辑态块的内容区闪了没」由真机复核（真机上它当然是有文本的）。
 * - 落点落行尾**依赖 `focus('end')` 分支**：本网以「激活后 PM 选区停在文档末尾」断言（G 组）。若
 *   残留 `pendingClickCoords`（`deactivateBlock` 不清 pending 系列），`focusActiveEditor` 会先走
 *   点击坐标分支 —— 那个分支的坐标基本落在新挂编辑器之外，PM 判 null 后仍回落 `focus('end')`，
 *   故结论不变；但这条链路**没有**单独断言。
 * - 验收 4 的字面要求是「**>1000 块页模拟下** 32MB 预算生效」。本网（集成网，走真实
 *   wasm + persistAll）按用户裁定改为**注入小 maxBytes** 验「裁最旧」语义 + 补一例默认
 *   32MB 下不裁；**>1000 块页 + 默认 32MB 的裁切**在 `useUndoHistory.test.ts`（单测、假
 *   定时器、不碰 wasm）单独钉住 —— 见其「预算裁切」组。
 * - 验收 5「禁用内置历史后无『无反应』落点」的**禁用侧**（`undoRedo:false` / 去 `history()`）
 *   由 #109 在 `Editor.vue`、`CodeMirrorEditor.vue` 钉住；本网只验**接管侧**行为。
 *
 * 时间口径：`configureUndoHistory({ idleMs: IDLE_MS })` + **真定时器**（不用 fake timers，
 * 避免与 wasm 的 promise 链纠缠）。`settleStep()` = 让逐页看门狗排程 + 越过 idle 窗口
 * ⇒ 该次改动封口成一步。`flushAsync()` = 越过若干宏任务，使 fire-and-forget 的
 * `runUndoRedo` 走完 `executeBatch` 单事务（undelete 已是其中 op，不再有独立 RPC 窗口）。
 *
 * 牙齿验证（2026-09-14）：临时摘掉 `BlockList.vue` 的 `handleDocUndoRedoKeyDown` 捕获接线，
 * 29 例（当时总数）由全绿转 **28 红 / 1 绿**。唯一未变红的是「别页块进同一 blocks 数组不改本页栈」——
 * 它不检验按键接线，只检验 T2 的逐页归因（对照信号在 T2 自己的单测里，与本文件分工不重叠）。
 * 每条「不接管」用例都自带对照组（同一夹具下 Ctrl+Z 必须被接管），故接线消失时它们也不会
 * 静默通过。现总数 37 例（2026-09-15 加 G 组落点 7 例）。
 */
import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll, vi, type MockInstance } from 'vitest'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import BlockList from './BlockList.vue'
import { useBlockStore } from '../stores/blocks'
import { useEditorStore } from '../stores/editor'
import { usePageStore } from '../stores/pages'
import { usePropertyStore } from '../stores/property'
import type { Page } from '../types/page'
import {
  resetUndoHistory,
  configureUndoHistory,
  ensureStack,
  canUndo,
  canRedo,
  _debugStats,
} from '../composables/useUndoHistory'
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

/** 统一 idle 窗口：真定时器下的短窗口，够「排程后越过」，不拖慢整套网 */
const IDLE_MS = 10

// ── 几何替身：块选区一建立即触发高亮层 watcher → jsdom 无 Range.getClientRects ──
let savedGetClientRects: PropertyDescriptor | undefined
let savedRangeGetBoundingClientRect: PropertyDescriptor | undefined
// ── 几何替身 2：落点要激活块 → 真挂 TipTap。ProseMirror 的 coordsAtPos 会拿
//    **Range**（文本节点包成 Range）做 singleRect：先 getClientRects()（替身 1 已给），
//    空则回落到 getBoundingClientRect()（jsdom 的 Range 没实现）→ 两者都要零矩形。
//    同为 jsdom 无布局能力，非本功能问题。──
let savedNodeGetBoundingClientRect: PropertyDescriptor | undefined
// ── 几何替身 3：`document.elementFromPoint`（jsdom 未实现）。落点激活块后，
//    focusActiveEditor 会消费「点击坐标」分支 → Editor.focusAtCoords → PM posAtCoords。
//    恒返回 null ⇒ PM 走 `!elt` → 矩形不含坐标 → posAtCoords 返回 null ⇒ 落 focus('end')。──
let savedElementFromPoint: PropertyDescriptor | undefined

const zeroRect = (): DOMRect => ({
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
}) as DOMRect

beforeAll(() => {
  savedGetClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    writable: true,
    value: () => [],
  })
  savedRangeGetBoundingClientRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    writable: true,
    value: zeroRect,
  })
  savedNodeGetBoundingClientRect = Object.getOwnPropertyDescriptor(Node.prototype, 'getBoundingClientRect')
  Object.defineProperty(Node.prototype, 'getBoundingClientRect', {
    configurable: true,
    writable: true,
    value: zeroRect,
  })
  savedElementFromPoint = Object.getOwnPropertyDescriptor(Document.prototype, 'elementFromPoint')
  Object.defineProperty(Document.prototype, 'elementFromPoint', {
    configurable: true,
    writable: true,
    value: () => null,
  })
})

afterAll(() => {
  if (savedGetClientRects) Object.defineProperty(Range.prototype, 'getClientRects', savedGetClientRects)
  else delete (Range.prototype as unknown as Record<string, unknown>).getClientRects
  if (savedRangeGetBoundingClientRect) {
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', savedRangeGetBoundingClientRect)
  } else {
    delete (Range.prototype as unknown as Record<string, unknown>).getBoundingClientRect
  }
  if (savedNodeGetBoundingClientRect) {
    Object.defineProperty(Node.prototype, 'getBoundingClientRect', savedNodeGetBoundingClientRect)
  } else {
    delete (Node.prototype as unknown as Record<string, unknown>).getBoundingClientRect
  }
  if (savedElementFromPoint) Object.defineProperty(Document.prototype, 'elementFromPoint', savedElementFromPoint)
  else delete (Document.prototype as unknown as Record<string, unknown>).elementFromPoint
})

// ── 几何替身 4（**逐例**装 / 还原，见 stubInkRects）：落点闪烁量的是**墨迹** ——
//    递归收集区域内的文本节点（`Range.getClientRects`）与原子元素的自身盒。jsdom 无布局 ⇒ 恒空
//    ⇒ 生产侧判定「无墨迹 ⇒ 不闪」，于是不装替身就**无法**证明闪烁真的画了出来（G 组主线）。──

/** 假矩形：把「来源」编码进 left（见 stubInkRects），不验像素 */
const inkRect = (left: number): DOMRect =>
  ({ x: left, y: 0, top: 0, left, width: 20, height: 10, right: left + 20, bottom: 10, toJSON: () => ({}) }) as DOMRect

/** 逐例装的「墨迹」替身的还原函数（由 afterEach 统一调用，见 afterEach 注释） */
let pendingInkRestore: (() => void) | null = null

/**
 * 「墨迹」替身（返回还原函数）。产品侧量墨迹 = 递归收集区域内的**文本节点**（按字量 `Range`）
 * 与原子元素的自身盒（`BlockList.vue` 的 `collectInkRects`）。
 *
 * 回答范围**有意收窄**：
 * - 文本落在 `.block-content` / `.block-properties` 内 ⇒ 给一个假矩形；
 * - 落在 `.ProseMirror` / `.cm-editor` 内部 ⇒ 仍给空表 —— 那是文件级替身 2/3 的地盘（真挂编辑器的
 *   几何交给真机），且 jsdom 里编辑态块的内容区本就没有渲染出文本，本网不假装它有（见文件头）。
 *
 * 假矩形把「哪一块、哪个区域」编码进 `left`（本网不验像素）：
 * - 内容区 = 该块在列表中的**序号**（1 起、按文档序）；属性区 = 1000 + 序号。
 *   用序号而非文本长度：jsdom 里编辑态块渲染不出文本，长度编不出来。
 *
 * 「空区域不亮」不必替身造：产品侧要求区域内**有文本节点**才算有墨迹，空属性带自然量不出矩形。
 * `onMeasure` 用来观察「量发生在哪一步」（如：是否在滚动之后）。
 */
function stubInkRects(onMeasure?: (region: Element) => void): () => void {
  const regionOf = (range: Range): Element | null => {
    const node = range.startContainer
    const el = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement) as Element | null
    if (!el || el.closest('.ProseMirror, .cm-editor')) return null
    return el.closest('.block-content, .block-properties')
  }
  const indexOf = (region: Element): number => {
    const blockEl = region.closest('[data-block-id]')
    const list = blockEl?.closest('.block-list')
    const all = list ? [...list.querySelectorAll('[data-block-id]')] : []
    return all.indexOf(blockEl as Element) + 1
  }
  const answer = function (this: Range): DOMRect | null {
    const region = regionOf(this)
    if (!region) return null
    onMeasure?.(region)
    const index = indexOf(region)
    return inkRect(region.classList.contains('block-properties') ? 1000 + index : index)
  }
  const savedRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
  const savedBox = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    writable: true,
    value: function (this: Range) {
      const rect = answer.call(this)
      return rect ? [rect] : []
    },
  })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    writable: true,
    value: function (this: Range) {
      return answer.call(this) ?? zeroRect()
    },
  })
  const restore = (): void => {
    if (savedRects) Object.defineProperty(Range.prototype, 'getClientRects', savedRects)
    if (savedBox) Object.defineProperty(Range.prototype, 'getBoundingClientRect', savedBox)
  }
  // 登记给 afterEach 统一还原：用例中途失败也不会把替身泄漏给后续用例
  pendingInkRestore = restore
  return restore
}

/** 已画出的闪烁矩形（left 即编码：内容区 = 块序号，属性区 = 1000 + 块序号） */
const flashLefts = (): number[] =>
  [...document.querySelectorAll<HTMLElement>('.restore-flash-rect')].map((el) => Number.parseFloat(el.style.left))

/** 闪烁覆盖到的**块序号**（去重，1 起按列表内文档序）—— 断「闪的是哪几块」用这个 */
const flashedBlocks = (): number[] => [...new Set(flashLefts().map((left) => left % 1000))]

// ── 夹具 ──────────────────────────────────────────────────────────

const stubGlobal = {
  stubs: {
    VueDraggable: { template: '<div><slot /></div>' },
    BlockDropIndicator: true,
  },
}

let mounted: VueWrapper | null = null

async function mountBlockList(pageId: string): Promise<VueWrapper> {
  const wrapper = mount(BlockList, {
    props: { pageId },
    attachTo: document.body,
    global: stubGlobal,
  })
  mounted = wrapper
  // tree 在父组件 onMounted 里由 store 构建，子列表经 defineModel 接收 →
  // 必须等一次 tick 子组件才拿到列表并渲染出块（同 #92 夹具）
  await nextTick()
  return wrapper
}

/** 取组件自己 provide 的选区实例（与真机诊断取法一致：不 mock 编排层） */
function getSelection(wrapper: VueWrapper): CrossBlockSelection {
  const root = wrapper.element as HTMLElement & {
    __vueParentComponent?: { provides?: Record<string, unknown> }
  }
  const selection = root.__vueParentComponent?.provides?.crossBlockSelection
  if (!selection) throw new Error('未取到 crossBlockSelection（组件未 provide？）')
  return selection as CrossBlockSelection
}

function blockEl(wrapper: VueWrapper, blockId: string): HTMLElement {
  const el = wrapper.element.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`)
  if (!el) throw new Error(`未渲染块 ${blockId}`)
  return el
}

/**
 * 给某块的**属性带**注入一段真实文本 —— 只为让替身量得出墨迹。
 *
 * 为什么需要：jsdom 里**编辑态块的内容区渲染不出文本**（TipTap 真挂了，但那条路按零矩形处理，
 * 见替身 2/3），而落点恰恰总会激活目标块 —— 不给它造点墨迹，G 组里「目标块闪了没」就无从断言。
 * 属性带不受激活影响（`PropertyDisplay` 不依赖 `isActive`），于是拿它当载体；真机上属性带的墨迹
 * 本来就是属性 chip 的文字，同一条路径。**必须在撤销之前注入**（落点在撤销的 nextTick 里量）。
 */
function inkInProperties(wrapper: VueWrapper, blockId: string): void {
  const band = blockEl(wrapper, blockId).querySelector('.block-properties')
  if (!band) throw new Error(`未渲染属性带 ${blockId}`)
  band.appendChild(document.createTextNode('p'))
}

interface KeyInit {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}

function dispatchKey(target: EventTarget, init: KeyInit): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(ev)
  return ev
}

const undoKey = (target: EventTarget, extra: Partial<KeyInit> = {}): KeyboardEvent =>
  dispatchKey(target, { key: 'z', ctrlKey: true, ...extra })

/** 越过若干宏任务：让 fire-and-forget 的 runUndoRedo 走完恢复（含两段 RPC） */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await flushPromises()
    await new Promise((r) => setTimeout(r, 0))
  }
  await flushPromises()
}

/** 让逐页看门狗排程 + 越过 idle 窗口 ⇒ 上一步改动封口入栈，并落库到位 */
async function settleStep(): Promise<void> {
  await nextTick()
  await new Promise((r) => setTimeout(r, IDLE_MS + 10))
  await flushPromises()
  await persistAll()
}

/**
 * 落库屏障。撤销要走 `executeBatch`（undelete op / block update / delete 均在单事务内），
 * 这些都要求**行已存在于库中**；而 store 的落库是 `SAVE_DEBOUNCE_MS` 防抖的，
 * 比本网步长（IDLE_MS）长得多 —— 不显式 flush，撤销会以 `Block not found` 失败
 * （与 #109 记的「落库时序」同族，但这是夹具义务，不是产品缺陷）。
 */
async function persistAll(): Promise<void> {
  const store = useBlockStore()
  await Promise.all(store.blocks.map((b) => store.flushSave(b.id)))
  await flushPromises()
}

/** 顺序建块（parentId 一律 null，即平铺同级），返回 id 列表 */
async function seed(pageId: string, contents: string[]): Promise<string[]> {
  const store = useBlockStore()
  const ids: string[] = []
  for (const content of contents) {
    const b = await store.createBlock({ pageId, content, parentId: null })
    ids.push(b.id)
  }
  await persistAll()
  return ids
}

const contentOf = (id: string): string | undefined => useBlockStore().getBlock(id)?.content

/** 直接落 store 的正文改写 —— 等价于「300ms 落库防抖已跑完」的那一刻（防抖本身不属本票） */
function typeInto(id: string, text: string): void {
  const block = useBlockStore().getBlock(id)
  if (!block) throw new Error(`未找到块 ${id}`)
  block.content = text
}

/** 一次「输入突发」：改正文 + 越过 idle 窗口封口成一步 */
async function typeStep(id: string, text: string): Promise<void> {
  typeInto(id, text)
  await settleStep()
}

/**
 * 对照组：同一夹具下 Ctrl+Z 必须被接管 —— 否则「不接管」类负断言在功能消失时会静默通过。
 * 每条负例都调用它，使负断言自带正对照（本文件 7 处负例已接入）。
 */
async function expectUndoStillWorks(id: string): Promise<void> {
  const control = undoKey(document.body)
  await flushAsync()
  expect(control.defaultPrevented).toBe(true)
  expect(contentOf(id)).toBe('v0')
}

/**
 * 造一条页面行 —— 只为让 BlockList 的 `rootBlockId`（= pageStore 里该页的 blockId）非空。
 * 字段照 `types/page.ts` 补全，不用 `as unknown as` 强转。
 */
function pageRow(id: string, blockId: string | null): Page {
  return {
    id,
    blockId,
    title: 'T',
    type: 'normal',
    icon: null,
    cover: null,
    aliases: [],
    filePath: null,
    childrenCount: 0,
    wordCount: 0,
    createdAt: 0,
    updatedAt: 0,
    deleted: false,
    deletedAt: null,
  }
}

// ── 生命周期 ──────────────────────────────────────────────────────

let errorSpy: MockInstance

beforeEach(() => {
  setActivePinia(createPinia())
  // 撤销栈是模块级单例：不重置会让上一条用例的栈（含游标）泄漏（#108 已踩过）
  resetUndoHistory()
  configureUndoHistory({ idleMs: IDLE_MS })
  // runUndoRedo 的失败是 fire-and-forget + console.error ⇒ 静默失败会把断言变成
  // 「什么都没发生」。收敛成宿主的失败信号。
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  // 必须先卸载再清 DOM：直接清空 body 会让残留实例（Sortable force-fallback）派发伪
  // `@end` → `syncTreeToStore` 回写 store，污染后续用例（曾让块凭空消失）
  if (mounted) {
    try {
      mounted.unmount()
    } catch {
      // 用例内已自行卸载
    }
    mounted = null
  }
  document.body.innerHTML = ''
  // 逐例装的「墨迹」替身：统一在这里还原 —— 用例中途失败也不会泄漏给后续用例
  pendingInkRestore?.()
  pendingInkRestore = null
  const silent = errorSpy.mock.calls.filter((c) => String(c[0]).includes('[undo] 恢复失败'))
  errorSpy.mockRestore()
  expect(
    silent,
    `撤销/重做过程中出现静默失败: ${String(silent[0]?.[1] ?? '')}`,
  ).toHaveLength(0)
})

// ══════════════════════════════════════════════════════════════════
// A. 三键路由（capture 阶段接管，ADR-0046 D2）
// ══════════════════════════════════════════════════════════════════

describe('A. 三键路由', () => {
  /** 每题共用：一块 v0，mount 后改成 v1 并封口成一步 */
  async function setupOneStep(pageId: string): Promise<{ wrapper: VueWrapper; id: string }> {
    const [id] = await seed(pageId, ['v0'])
    const wrapper = await mountBlockList(pageId)
    await typeStep(id, 'v1')
    return { wrapper, id }
  }

  test('Ctrl+Z → 接管并撤销', async () => {
    const pageId = 'page-undo-chord-z'
    const { wrapper, id } = await setupOneStep(pageId)

    const ev = undoKey(document.body)
    await flushAsync()

    expect(ev.defaultPrevented).toBe(true)
    expect(contentOf(id)).toBe('v0')
    wrapper.unmount()
  })

  test('Ctrl+Shift+Z → 接管并重做', async () => {
    const pageId = 'page-undo-chord-shiftz'
    const { wrapper, id } = await setupOneStep(pageId)

    undoKey(document.body)
    await flushAsync()
    expect(contentOf(id)).toBe('v0')

    const ev = undoKey(document.body, { shiftKey: true })
    await flushAsync()

    expect(ev.defaultPrevented).toBe(true)
    expect(contentOf(id)).toBe('v1')
    wrapper.unmount()
  })

  test('Ctrl+Y → 接管（与 Ctrl+Shift+Z 同语义）', async () => {
    const pageId = 'page-undo-chord-y'
    const { wrapper, id } = await setupOneStep(pageId)

    undoKey(document.body)
    await flushAsync()
    expect(contentOf(id)).toBe('v0')

    const ev = dispatchKey(document.body, { key: 'y', ctrlKey: true })
    await flushAsync()

    expect(ev.defaultPrevented).toBe(true)
    expect(contentOf(id)).toBe('v1')
    wrapper.unmount()
  })

  test('Cmd+Z（metaKey）→ 与 Ctrl+Z 同语义', async () => {
    const pageId = 'page-undo-chord-meta'
    const { wrapper, id } = await setupOneStep(pageId)

    const ev = dispatchKey(document.body, { key: 'z', metaKey: true })
    await flushAsync()

    expect(ev.defaultPrevented).toBe(true)
    expect(contentOf(id)).toBe('v0')
    wrapper.unmount()
  })

  test('无修饰 z → 不接管', async () => {
    const pageId = 'page-undo-chord-plain'
    const { wrapper, id } = await setupOneStep(pageId)

    const ev = dispatchKey(document.body, { key: 'z' })
    await flushAsync()

    expect(ev.defaultPrevented).toBe(false)
    expect(contentOf(id)).toBe('v1')

    await expectUndoStillWorks(id)
    wrapper.unmount()
  })

  test('Ctrl+Alt+Z → 不接管（Alt 组合让路）', async () => {
    const pageId = 'page-undo-chord-alt'
    const { wrapper, id } = await setupOneStep(pageId)

    const ev = undoKey(document.body, { altKey: true })
    await flushAsync()

    expect(ev.defaultPrevented).toBe(false)
    expect(contentOf(id)).toBe('v1')

    await expectUndoStillWorks(id)
    wrapper.unmount()
  })

  test('Ctrl+Q（非撤销键）→ 不接管', async () => {
    const pageId = 'page-undo-chord-other'
    const { wrapper, id } = await setupOneStep(pageId)

    const ev = dispatchKey(document.body, { key: 'q', ctrlKey: true })
    await flushAsync()

    expect(ev.defaultPrevented).toBe(false)
    expect(contentOf(id)).toBe('v1')

    await expectUndoStillWorks(id)
    wrapper.unmount()
  })
})

// ══════════════════════════════════════════════════════════════════
// B. 四焦点作用域 + 已裁定边界（#109）
// ══════════════════════════════════════════════════════════════════

describe('B. 焦点作用域', () => {
  test('编辑态：块内 ProseMirror 焦点 → 接管并撤销', async () => {
    const pageId = 'page-undo-focus-prosemirror'
    const [id] = await seed(pageId, ['v0'])
    const wrapper = await mountBlockList(pageId)
    await typeStep(id, 'v1')

    const pm = document.createElement('div')
    pm.className = 'ProseMirror'
    pm.setAttribute('contenteditable', 'true')
    pm.textContent = 'v1'
    blockEl(wrapper, id).querySelector('.block-content')!.appendChild(pm)

    const ev = undoKey(pm)
    await flushAsync()

    expect(ev.defaultPrevented).toBe(true)
    expect(contentOf(id)).toBe('v0')
    pm.remove()
    wrapper.unmount()
  })

  test('编辑态：块内 CodeMirror 焦点 → 同样接管（作用域判定不咨询 isInEditableInput）', async () => {
    const pageId = 'page-undo-focus-codemirror'
    const [id] = await seed(pageId, ['v0'])
    const wrapper = await mountBlockList(pageId)
    await typeStep(id, 'v1')

    // 注：`isInEditableInput` 对 `.cm-content`（不在 .ProseMirror 内）其实返回 true，
    // 但撤销的作用域判定 `resolveUndoScopePage` **根本不咨询它**（只豁免 input/textarea），
    // 故代码块编辑区仍归统一栈接管。
    const cmWrap = document.createElement('div')
    cmWrap.className = 'cm-editor'
    const cmContent = document.createElement('div')
    cmContent.className = 'cm-content'
    cmContent.setAttribute('contenteditable', 'true')
    cmWrap.appendChild(cmContent)
    blockEl(wrapper, id).querySelector('.block-content')!.appendChild(cmWrap)

    const ev = undoKey(cmContent)
    await flushAsync()

    expect(ev.defaultPrevented).toBe(true)
    expect(contentOf(id)).toBe('v0')
    cmWrap.remove()
    wrapper.unmount()
  })

  test('非编辑态：块选区已固化 + body 焦点 → 接管', async () => {
    const pageId = 'page-undo-focus-blockselect'
    const [id] = await seed(pageId, ['v0'])
    const wrapper = await mountBlockList(pageId)
    const selection = getSelection(wrapper)
    selection.toggleBlock(id, pageId)
    await typeStep(id, 'v1')

    const ev = undoKey(document.body)
    await flushAsync()

    expect(ev.defaultPrevented).toBe(true)
    expect(contentOf(id)).toBe('v0')
    wrapper.unmount()
  })

  test('空白：焦点落在列表容器（非块元素）→ 接管', async () => {
    const pageId = 'page-undo-focus-blank'
    const [id] = await seed(pageId, ['v0'])
    const wrapper = await mountBlockList(pageId)
    await typeStep(id, 'v1')

    const container = wrapper.element as HTMLElement
    const ev = undoKey(container)
    await flushAsync()

    expect(ev.defaultPrevented).toBe(true)
    expect(contentOf(id)).toBe('v0')
    wrapper.unmount()
  })

  test('四焦点下的重做两键（Ctrl+Shift+Z / Ctrl+Y）同样被接管', async () => {
    const pageId = 'page-undo-focus-redo-matrix'
    const [id] = await seed(pageId, ['v0'])
    const wrapper = await mountBlockList(pageId)
    await typeStep(id, 'v1')

    const pm = document.createElement('div')
    pm.className = 'ProseMirror'
    pm.setAttribute('contenteditable', 'true')
    blockEl(wrapper, id).querySelector('.block-content')!.appendChild(pm)

    const targets: Array<[string, EventTarget]> = [
      ['块内编辑区', pm],
      ['块内非编辑区', blockEl(wrapper, id)],
      ['列表空白', wrapper.element as HTMLElement],
      ['body（无焦点元素）', document.body],
    ]
    const chords: Array<[string, KeyInit]> = [
      ['Ctrl+Shift+Z', { key: 'z', ctrlKey: true, shiftKey: true }],
      ['Ctrl+Y', { key: 'y', ctrlKey: true }],
    ]

    for (const [focusName, target] of targets) {
      for (const [chordName, init] of chords) {
        // 每轮先撤到 v0、再用该焦点下的重做键恢复 —— 轮次之间互不残留
        undoKey(document.body)
        await flushAsync()
        expect(contentOf(id), `${focusName}：撤销后应回到 v0`).toBe('v0')

        const ev = dispatchKey(target, init)
        await flushAsync()
        expect(ev.defaultPrevented, `${focusName} / ${chordName} 应被接管`).toBe(true)
        expect(contentOf(id), `${focusName} / ${chordName} 应重做`).toBe('v1')
      }
    }

    pm.remove()
    wrapper.unmount()
  })

  test('原生输入控件（input）→ 不接管，保留浏览器自身撤销', async () => {
    const pageId = 'page-undo-focus-input'
    const [id] = await seed(pageId, ['v0'])
    const wrapper = await mountBlockList(pageId)
    await typeStep(id, 'v1')

    const input = document.createElement('input')
    blockEl(wrapper, id).appendChild(input)

    const ev = undoKey(input)
    await flushAsync()

    expect(ev.defaultPrevented).toBe(false)
    expect(contentOf(id)).toBe('v1')

    await expectUndoStillWorks(id)
    input.remove()
    wrapper.unmount()
  })

  test('侧栏（.sidebar-wrapper 内）→ 不接管', async () => {
    const pageId = 'page-undo-focus-sidebar'
    const [id] = await seed(pageId, ['v0'])
    const wrapper = await mountBlockList(pageId)
    await typeStep(id, 'v1')

    const sidebar = document.createElement('div')
    sidebar.className = 'sidebar-wrapper'
    const inner = document.createElement('div')
    sidebar.appendChild(inner)
    document.body.appendChild(sidebar)

    const ev = undoKey(inner)
    await flushAsync()

    expect(ev.defaultPrevented).toBe(false)
    expect(contentOf(id)).toBe('v1')

    await expectUndoStillWorks(id)
    sidebar.remove()
    wrapper.unmount()
  })

  test('列表之外的目标 → 不接管（实例归属守卫）', async () => {
    const pageId = 'page-undo-focus-outside'
    const [id] = await seed(pageId, ['v0'])
    const wrapper = await mountBlockList(pageId)
    await typeStep(id, 'v1')

    const outside = document.createElement('div')
    document.body.appendChild(outside)

    const ev = undoKey(outside)
    await flushAsync()

    expect(ev.defaultPrevented).toBe(false)
    expect(contentOf(id)).toBe('v1')

    await expectUndoStillWorks(id)
    outside.remove()
    wrapper.unmount()
  })

  test('他页块（无栈）→ 不接管（memento 机制边界：未整页加载无快照可撤）', async () => {
    const pageId = 'page-undo-focus-otherpage'
    const [id] = await seed(pageId, ['v0'])
    const wrapper = await mountBlockList(pageId)
    await typeStep(id, 'v1')

    // 他页块：不属于本列表实例，其 id 在 store 里有归属页，但那页从未 ensureStack
    const [foreignId] = await seed('page-undo-focus-foreign', ['别页内容'])
    const foreignEl = document.createElement('div')
    foreignEl.setAttribute('data-block-id', foreignId)
    document.body.appendChild(foreignEl)

    const ev = undoKey(foreignEl)
    await flushAsync()

    expect(ev.defaultPrevented).toBe(false)
    expect(contentOf(id)).toBe('v1')

    await expectUndoStillWorks(id)
    foreignEl.remove()
    wrapper.unmount()
  })

  test('他页块（有栈，BlockModal 复用该页栈）→ 接管该页撤销，本页不动', async () => {
    const pageId = 'page-undo-focus-otherpage-stacked'
    const [id] = await seed(pageId, ['v0'])
    const wrapper = await mountBlockList(pageId)
    await typeStep(id, 'v1')

    // 他页块：先 seed 再 ensureStack，模拟「该页曾整页加载、已有撤销栈」（D6 复用该页栈）
    const foreignPageId = 'page-undo-focus-foreign-stacked'
    const [foreignId] = await seed(foreignPageId, ['f0'])
    ensureStack(foreignPageId)
    await typeStep(foreignId, 'f1')

    const foreignEl = document.createElement('div')
    foreignEl.setAttribute('data-block-id', foreignId)
    document.body.appendChild(foreignEl)

    const ev = undoKey(foreignEl)
    await flushAsync()

    expect(ev.defaultPrevented).toBe(true)
    expect(contentOf(foreignId)).toBe('f0') // 他页被撤销
    expect(contentOf(id)).toBe('v1') // 本页不受影响

    foreignEl.remove()
    wrapper.unmount()
  })

  test('落点排除页面根块（#109 评审修复）', async () => {
    const pageStore = usePageStore()
    const store = useBlockStore()
    const pageId = 'page-undo-root-exclude'

    const root = await store.createBlock({ pageId, content: '' })
    // BlockList 的 rootBlockId = pageStore.getPage(pageId).blockId
    pageStore.pages = [pageRow(pageId, root.id)]
    await store.createBlock({ pageId, content: '子块', parentId: root.id })

    const wrapper = await mountBlockList(pageId)
    const selection = getSelection(wrapper)
    // 装上「墨迹」替身：否则本例的「没有闪烁矩形」会退化成「量不出墨迹」的副产物，毫无牙力
    stubInkRects()

    // 只让「根块」受影响：改它的 format，撤销时恢复集合里便只有根块
    await store.updateBlockFormat(root.id, { collapsed: true })
    await settleStep()

    const ev = undoKey(document.body)
    await flushAsync()

    expect(ev.defaultPrevented).toBe(true)
    expect(store.getBlock(root.id)!.format?.collapsed).toBeFalsy()
    // 受影响块只有根块 ⇒ 过滤后无落点；若不过滤，根块会进选区 / 被激活 / 被画矩形
    // （根块不参与渲染，故按「页面里没有任何闪烁矩形」断言）
    expect(selection.anchorIds.has(root.id)).toBe(false)
    expect(selection.anchorIds.size).toBe(0)
    expect(flashLefts()).toEqual([])
    expect(useEditorStore().activeBlockId).toBeNull()
    wrapper.unmount()
  })
})

// ══════════════════════════════════════════════════════════════════
// C. 粒度封口（D2/D3）：一步 = 一次输入突发，顺序正确回退
// ══════════════════════════════════════════════════════════════════

describe('C. 粒度封口', () => {
  test('打字 → 停顿 → 打字 → 结构操作：Ctrl+Z 逆序回退，无穿越焦点', async () => {
    const pageId = 'page-undo-grain-order'
    const [a] = await seed(pageId, ['第一段'])
    const wrapper = await mountBlockList(pageId)

    await typeStep(a, '第一段+')
    await typeStep(a, '第一段++')
    const newId = (await useBlockStore().createBlock({ pageId, content: '新块', parentId: null })).id
    await settleStep()

    expect(canUndo(pageId)).toBe(true)

    // ① 撤掉结构操作
    undoKey(document.body)
    await flushAsync()
    expect(useBlockStore().getBlock(newId)).toBeUndefined()
    expect(contentOf(a)).toBe('第一段++')

    // ② 撤掉第二次输入
    undoKey(document.body)
    await flushAsync()
    expect(contentOf(a)).toBe('第一段+')

    // ③ 撤掉第一次输入
    undoKey(document.body)
    await flushAsync()
    expect(contentOf(a)).toBe('第一段')
    expect(canUndo(pageId)).toBe(false)

    wrapper.unmount()
  })

  test('一次突发内的多次写入合并为一步（同一 idle 窗口）', async () => {
    const pageId = 'page-undo-grain-burst'
    const [a] = await seed(pageId, ['起点'])
    const wrapper = await mountBlockList(pageId)

    const before = _debugStats().timelineLen
    typeInto(a, '起')
    await nextTick()
    await typeStep(a, '起点改')

    expect(_debugStats().timelineLen).toBe(before + 1)

    undoKey(document.body)
    await flushAsync()
    expect(contentOf(a)).toBe('起点')
    wrapper.unmount()
  })
})

// ══════════════════════════════════════════════════════════════════
// D. 无「无反应」落点（#109 验收 5 / #110 验收 5）
// ══════════════════════════════════════════════════════════════════

describe('D. 无「无反应」落点', () => {
  test('改动已进 store 但 idle 未到 → Ctrl+Z 仍回退（封口生效）', async () => {
    const pageId = 'page-undo-noblank-commit'
    const [a] = await seed(pageId, ['原始'])
    const wrapper = await mountBlockList(pageId)

    typeInto(a, '改后')
    // 只让看门狗排程，不越过 idle 窗口 ⇒ 此刻栈顶仍是「输入前」
    await nextTick()
    expect(canUndo(pageId)).toBe(false)

    const ev = undoKey(document.body)
    await flushAsync()

    expect(ev.defaultPrevented).toBe(true)
    expect(contentOf(a)).toBe('原始')
    wrapper.unmount()
  })

  test('编辑态落在别页块上（BlockModal）→ 不劫持本页撤销，也不连坐清掉别页编辑态', async () => {
    const pageId = 'page-undo-editstate-foreign'
    const [id] = await seed(pageId, ['原始'])
    const wrapper = await mountBlockList(pageId)
    const editorStore = useEditorStore()

    // BlockModal 场景：主列表挂在本页，编辑态却落在另一页的块上。
    // 该块不在本列表渲染树内 ⇒ 不会挂起真编辑器，夹具与语义都干净。
    const [foreignId] = await seed('page-undo-editstate-foreign-target', ['别页'])
    editorStore.activateBlock(foreignId, 1)
    await nextTick()
    expect(editorStore.activeBlockId).toBe(foreignId)

    await typeStep(id, '改后')

    const ev = undoKey(document.body)
    await flushAsync()

    expect(ev.defaultPrevented).toBe(true)
    expect(contentOf(id)).toBe('原始')
    // 与 B 组「他页块 → 不接管」区分：那条讲的是**焦点落在别页块元素上**（故不接管）；
    // 本条讲的是**焦点在本页列表（body）、编辑态却挂在别页块上** —— runUndoRedo 的
    // 「退出编辑态」守卫按「该块是否属于本页」判定，故本页撤销照常生效，且不连坐清掉别页编辑态
    expect(editorStore.activeBlockId).toBe(foreignId)
    wrapper.unmount()
  })

  test('无改动时连按 Ctrl+Z 不截断重做分支（封口 no-op）', async () => {
    const pageId = 'page-undo-noblank-redokeep'
    const [a] = await seed(pageId, ['v0'])
    const wrapper = await mountBlockList(pageId)
    await typeStep(a, 'v1')

    undoKey(document.body)
    await flushAsync()
    expect(contentOf(a)).toBe('v0')
    expect(canRedo(pageId)).toBe(true)

    // 再按一次（此时已无改动）：封口必须是 no-op，否则截掉 redo 尾
    undoKey(document.body)
    await flushAsync()
    expect(canRedo(pageId)).toBe(true)

    dispatchKey(document.body, { key: 'z', ctrlKey: true, shiftKey: true })
    await flushAsync()
    expect(contentOf(a)).toBe('v1')

    wrapper.unmount()
  })
})

// ══════════════════════════════════════════════════════════════════
// E. D4 视图状态三分法
// ══════════════════════════════════════════════════════════════════

describe('E. D4 三分法', () => {
  test('① 用户主动折叠 → 入栈；Ctrl+Z 回滚折叠标志', async () => {
    const store = useBlockStore()
    const pageId = 'page-undo-d4-collapse'
    const parent = await store.createBlock({ pageId, content: '父' })
    await store.createBlock({ pageId, content: '子', parentId: parent.id })

    const wrapper = await mountBlockList(pageId)
    await store.updateBlockFormat(parent.id, { collapsed: true })
    await settleStep()
    expect(store.getBlock(parent.id)!.format.collapsed).toBe(true)

    undoKey(document.body)
    await flushAsync()

    expect(store.getBlock(parent.id)!.format?.collapsed).toBeFalsy()
    wrapper.unmount()
  })

  test('② 缩进进折叠父块的派生展开 → 随操作一起回滚', async () => {
    const store = useBlockStore()
    const pageId = 'page-undo-d4-derive'
    const a = await store.createBlock({ pageId, content: 'A' })
    const b = await store.createBlock({ pageId, content: 'B' })

    const wrapper = await mountBlockList(pageId)
    // 让 A 成为「已折叠」的父块（不变量「无子节点 ⇒ 不折叠」在读取侧派生，写入侧允许先置）
    await store.updateBlockFormat(a.id, { collapsed: true })
    await settleStep()

    await store.indent(b.id)
    await settleStep()

    // 派生结果：缩进成功 + 折叠父块被展开（ADR-0045 D4：落点必须是可见结果）
    expect(store.getBlock(b.id)!.parentId).toBe(a.id)
    expect(store.getBlock(a.id)!.format?.collapsed).toBeFalsy()

    undoKey(document.body)
    await flushAsync()

    // 派生展开与缩进同属一步 ⇒ 一起回滚
    expect(store.getBlock(b.id)!.parentId).toBe(null)
    expect(store.getBlock(a.id)!.format?.collapsed).toBe(true)
    wrapper.unmount()
  })

  test('③ 视图噪声不进栈：块选区变化不改栈，且 Ctrl+Z 仍退上一步（不「看似无反应」）', async () => {
    const pageId = 'page-undo-d4-noise'
    const [a] = await seed(pageId, ['起点'])
    const wrapper = await mountBlockList(pageId)
    const selection = getSelection(wrapper)

    await typeStep(a, '改动')

    const before = _debugStats().timelineLen
    selection.toggleBlock(a.id, pageId)
    selection.clearSelection()
    await flushAsync()

    expect(_debugStats().timelineLen).toBe(before)
    expect(canUndo(pageId)).toBe(true)

    undoKey(document.body)
    await flushAsync()
    expect(contentOf(a)).toBe('起点')
    wrapper.unmount()
  })

  test('③ 视图噪声不进栈：光标 / 滚动 / 页切换', async () => {
    const pageId = 'page-undo-d4-cursor-scroll-page'
    const [a] = await seed(pageId, ['起点'])
    const wrapper = await mountBlockList(pageId)
    const editorStore = useEditorStore()
    const pageStore = usePageStore()

    await typeStep(a, '改动')

    const before = _debugStats().timelineLen

    // 光标 / 点击坐标：只动编辑器 store，不碰 blocks
    editorStore.setCursorPos(3)
    editorStore.setClickCoords({ x: 10, y: 20 })
    // 滚动：走 BlockList 真实的 document scroll 监听（handleViewportChange）
    const rootEl = wrapper.element as HTMLElement
    rootEl.scrollTop = 120
    document.dispatchEvent(new Event('scroll', { bubbles: true }))
    // 页切换
    pageStore.setCurrentPage('page-undo-d4-elsewhere')
    await flushAsync()

    expect(_debugStats().timelineLen).toBe(before)
    expect(canUndo(pageId)).toBe(true)

    // 不「看似无反应」：随后的 Ctrl+Z 仍退上一步内容
    undoKey(document.body)
    await flushAsync()
    expect(contentOf(a)).toBe('起点')
    wrapper.unmount()
  })

  test('③ 视图噪声不进栈：别页块进同一 blocks 数组不改本页栈（逐页归因）', async () => {
    const pageId = 'page-undo-d4-otherpage-load'
    await seed(pageId, ['本页'])
    const wrapper = await mountBlockList(pageId)

    expect(_debugStats().timelineLen).toBe(1)
    await seed('page-undo-d4-background', ['别页一', '别页二'])
    await settleStep()

    expect(_debugStats().timelineLen).toBe(1)
    expect(canUndo(pageId)).toBe(false)
    wrapper.unmount()
  })
})

// ══════════════════════════════════════════════════════════════════
// F. D5 字节预算裁切
// ══════════════════════════════════════════════════════════════════

describe('F. 字节预算裁切', () => {
  test('超预算时裁最旧（最旧那步从此不可达）', async () => {
    const pageId = 'page-undo-budget'
    const [a] = await seed(pageId, ['v0'])
    const wrapper = await mountBlockList(pageId)

    // 以「一份快照的实测字节数」标定预算：容得下约 2 份 ⇒ 后续必然触发裁切
    const oneSnapshot = _debugStats().totalBytes
    expect(oneSnapshot).toBeGreaterThan(0)
    configureUndoHistory({ maxBytes: Math.ceil(oneSnapshot * 2.5) })

    const steps = 8
    for (let i = 1; i <= steps; i++) {
      typeInto(a, `v${i}`)
      await settleStep()
    }

    const stats = _debugStats()
    expect(stats.totalBytes).toBeLessThanOrEqual(Math.ceil(oneSnapshot * 2.5))
    expect(stats.stackSizes[pageId]).toBeLessThanOrEqual(3)

    // 一路撤到底：既确实退回了几步（非空转），又到不了起点 v0（最旧那步已被裁掉）
    let guard = 0
    while (canUndo(pageId) && guard++ < steps + 5) {
      undoKey(document.body)
      await flushAsync()
    }
    const stopped = contentOf(a)
    expect(stopped).not.toBe(`v${steps}`)
    expect(stopped).not.toBe('v0')
    wrapper.unmount()
  })

  test('默认 32MB 预算下不裁切（真实语料远未触顶）', async () => {
    const pageId = 'page-undo-budget-default'
    const [a] = await seed(pageId, ['v0'])
    const wrapper = await mountBlockList(pageId)

    for (let i = 1; i <= 5; i++) {
      typeInto(a, `v${i}`)
      await settleStep()
    }

    expect(_debugStats().stackSizes[pageId]).toBe(6)

    // 「不裁切」的实质 = 一路撤得回起点（而不是看一个必然成立的字节上界）
    let guard = 0
    while (canUndo(pageId) && guard++ < 10) {
      undoKey(document.body)
      await flushAsync()
    }
    expect(contentOf(a)).toBe('v0')
    wrapper.unmount()
  })
})

// ══════════════════════════════════════════════════════════════════
// G. 落点：短暂闪烁 + 光标（修订 #109「undo 落点 = 块选区选中态」）
// ══════════════════════════════════════════════════════════════════

describe('G. 落点：闪烁 + 光标', () => {
  /** 与 BlockList.vue 的 UNDO_FLASH_MS 对齐；只用它等「闪烁窗口结束」，不验时长本身 */
  const FLASH_MS = 600

  /** 越过闪烁窗口 ⇒ BlockList 的计时器清空闪烁矩形列表 */
  async function flashSettled(): Promise<void> {
    await new Promise((r) => setTimeout(r, FLASH_MS + 50))
    await nextTick()
  }

  test('undo：不进块选区；受影响块画一次闪烁；光标落进该块', async () => {
    const pageId = 'page-undo-landing-single'
    const [id] = await seed(pageId, ['v0'])
    const wrapper = await mountBlockList(pageId)
    const selection = getSelection(wrapper)
    const editorStore = useEditorStore()
    stubInkRects()

    await typeStep(id, 'v1')
    inkInProperties(wrapper, id)

    const ev = undoKey(document.body)
    await flushAsync()

    expect(ev.defaultPrevented).toBe(true)
    expect(contentOf(id)).toBe('v0')
    // ① 不再建块选区（持久高亮 → 一次闪烁）
    expect(selection.anchorIds.size).toBe(0)
    // ② 闪烁画了出来，且落在受影响块上（「闪的是哪几块」= 编码反查，见 stubInkRects）。
    //    该块此刻是编辑态，jsdom 里内容区渲染不出文本 ⇒ 这一例的墨迹来自它的属性带
    expect(flashedBlocks()).toEqual([1])
    // ③ 光标（编辑态）落进该块 —— 与块选区互斥：激活时 focusActiveEditor 先 clearSelection
    expect(editorStore.activeBlockId).toBe(id)

    await flashSettled()
    expect(flashLefts()).toEqual([])
    wrapper.unmount()
  })

  test('一次突发改两块（同一步）：闪烁覆盖全部受影响块（内容区 + 属性区都量到），光标落文档序最后一块', async () => {
    const pageId = 'page-undo-landing-multi'
    const [a, b] = await seed(pageId, ['A0', 'B0'])
    const wrapper = await mountBlockList(pageId)
    const editorStore = useEditorStore()
    stubInkRects()

    typeInto(a, 'A1')
    typeInto(b, 'B1')
    await settleStep() // 同一 idle 窗口 ⇒ 一步
    // b 是落点（会被激活）⇒ 内容区在 jsdom 里量不出墨迹，改从它的属性带取
    inkInProperties(wrapper, b)

    undoKey(document.body)
    await flushAsync()

    expect(contentOf(a)).toBe('A0')
    expect(contentOf(b)).toBe('B0')
    // a（非编辑态）的**内容区** = 序号 1；b 的**属性区** = 1000 + 序号 2 —— 两个区域都在闪烁范围内
    expect(flashLefts()).toEqual([1, 1002])
    expect(editorStore.activeBlockId).toBe(b)
    wrapper.unmount()
  })

  test('redo：同样闪烁 + 光标落进目标块，不留持久高亮', async () => {
    const pageId = 'page-undo-landing-redo'
    const [id] = await seed(pageId, ['v0'])
    const wrapper = await mountBlockList(pageId)
    const selection = getSelection(wrapper)
    const editorStore = useEditorStore()
    stubInkRects()

    await typeStep(id, 'v1')
    inkInProperties(wrapper, id)

    undoKey(document.body)
    await flushAsync()
    expect(contentOf(id)).toBe('v0')

    const ev = dispatchKey(document.body, { key: 'z', ctrlKey: true, shiftKey: true })
    await flushAsync()

    expect(ev.defaultPrevented).toBe(true)
    expect(contentOf(id)).toBe('v1')
    expect(selection.anchorIds.size).toBe(0)
    expect(flashedBlocks()).toEqual([1])
    expect(editorStore.activeBlockId).toBe(id)

    await flashSettled()
    expect(flashLefts()).toEqual([])
    wrapper.unmount()
  })

  test('连按两次 undo：上一轮的闪烁矩形即刻让位给本轮（不残留旧块）', async () => {
    const pageId = 'page-undo-landing-replace'
    const [a, b] = await seed(pageId, ['A0', 'B0'])
    const wrapper = await mountBlockList(pageId)
    stubInkRects()

    await typeStep(a, 'A1')
    await typeStep(b, 'B1')
    // 两块都可能处于编辑态（jsdom 里内容区量不出墨迹）⇒ 各自从属性带取墨迹
    inkInProperties(wrapper, a)
    inkInProperties(wrapper, b)

    // 第一次 undo：只撤 B1
    undoKey(document.body)
    await flushAsync()
    expect(contentOf(b)).toBe('B0')
    expect(flashedBlocks()).toEqual([2])

    // 第二次 undo（未等闪烁窗口结束）：只撤 A1，B 的矩形必须已经让位
    undoKey(document.body)
    await flushAsync()
    expect(contentOf(a)).toBe('A0')
    expect(flashedBlocks()).toEqual([1])
    wrapper.unmount()
  })

  test('滚入视野：滚动目标 = 光标落点那块（文档序最后一块）', async () => {
    const pageId = 'page-undo-landing-scroll'
    const [a, b] = await seed(pageId, ['A0', 'B0'])
    const wrapper = await mountBlockList(pageId)

    // jsdom 没实现 Element.scrollIntoView（产品侧已有 typeof 守卫）→ 装上可观测替身。
    // 用 function 而非箭头，才能从 this 取回被滚动的元素。
    const scrolledIds: Array<string | null> = []
    // 「量发生在哪一步」的证人：产品侧若先量后滚，掉出视口的落点会被画在旧位置上
    const measuredAfterScroll: boolean[] = []
    stubInkRects(() => measuredAfterScroll.push(scrolledIds.length > 0))
    const savedScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
    const scrollSpy = vi.fn(function (this: HTMLElement) {
      scrolledIds.push(this.getAttribute('data-block-id'))
    })
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrollSpy,
    })

    try {
      typeInto(a, 'A1')
      typeInto(b, 'B1')
      await settleStep()
      inkInProperties(wrapper, b)

      undoKey(document.body)
      await flushAsync()

      expect(scrolledIds).toEqual([b])
      expect(scrollSpy).toHaveBeenCalledWith({ block: 'center' })
      // 落点那块确实闪了 —— 这一步改的是两块（同 idle 窗口），故两块都在闪烁集合里
      expect(flashedBlocks()).toEqual([1, 2])
      // 且矩形是**滚完之后**才量的（先量后滚 ⇒ 证人里出现 false）
      expect(measuredAfterScroll).not.toHaveLength(0)
      expect(measuredAfterScroll.every(Boolean)).toBe(true)
    } finally {
      if (savedScrollIntoView) Object.defineProperty(Element.prototype, 'scrollIntoView', savedScrollIntoView)
      else delete (Element.prototype as unknown as Record<string, unknown>).scrollIntoView
    }
    wrapper.unmount()
  })

  test('可见性门控：落点块已在视口内就不滚；掉出视口才滚（对照）', async () => {
    const pageId = 'page-undo-landing-scroll-gate'
    const [a, b] = await seed(pageId, ['A0', 'B0'])
    const wrapper = await mountBlockList(pageId)

    const scrolledIds: Array<string | null> = []
    const savedScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
    const savedGetRect = Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect')
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: function (this: HTMLElement) {
        scrolledIds.push(this.getAttribute('data-block-id'))
      },
    })
    // 只改**落点块**的矩形，其余元素保持 jsdom 的全零矩形（与不装替身等价，不影响其它路径）。
    // 视口内 / 视口外由 onScreen 切换 —— 同一落点、只变可见性，用来验「门控真的在判可见性」。
    let onScreen = true
    Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
      configurable: true,
      writable: true,
      value: function (this: Element) {
        const top = onScreen ? 100 : window.innerHeight + 50
        if (this.getAttribute('data-block-id') !== b) {
          return { top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
        }
        return {
          top,
          bottom: top + 37,
          height: 37,
          left: 0,
          right: 720,
          width: 720,
          x: 0,
          y: top,
          toJSON: () => ({}),
        } as DOMRect
      },
    })

    stubInkRects()

    try {
      typeInto(a, 'A1')
      typeInto(b, 'B1')
      await settleStep()
      inkInProperties(wrapper, b)

      // ① 落点块本就在眼前 ⇒ 不滚；但闪烁照旧 —— 门控只管位置，集合标识（闪烁）仍无条件给出
      undoKey(document.body)
      await flushAsync()
      expect(flashedBlocks()).toEqual([1, 2])
      expect(scrolledIds).toEqual([])

      // ② 同一落点掉出视口 ⇒ 滚（证明 ① 不是「替身坏了导致什么都不滚」）
      onScreen = false
      undoKey(document.body, { shiftKey: true })
      await flushAsync()
      expect(flashedBlocks()).toEqual([1, 2])
      expect(scrolledIds).toEqual([b])
    } finally {
      if (savedScrollIntoView) Object.defineProperty(Element.prototype, 'scrollIntoView', savedScrollIntoView)
      else delete (Element.prototype as unknown as Record<string, unknown>).scrollIntoView
      if (savedGetRect) Object.defineProperty(Element.prototype, 'getBoundingClientRect', savedGetRect)
      else delete (Element.prototype as unknown as Record<string, unknown>).getBoundingClientRect
    }
    wrapper.unmount()
  })

  test('光标落行尾：激活后编辑器选区停在文档末尾', async () => {
    const pageId = 'page-undo-landing-caret-end'
    const [id] = await seed(pageId, ['v0'])
    const wrapper = await mountBlockList(pageId)
    const editorStore = useEditorStore()

    await typeStep(id, 'v1')

    undoKey(document.body)
    await flushAsync()

    // activateBlock 不带 cursorPos ⇒ focusActiveEditor 走 focus('end') ⇒ PM 选区在文档末尾
    // （"v0" 的正文两端各占一个位置 ⇒ 行尾 = content.size - 1）
    const editor = editorStore.activeEditor
    expect(editor).not.toBeNull()
    expect(editor!.state.doc.textContent).toBe('v0')
    expect(editor!.state.selection.to).toBe(editor!.state.doc.content.size - 1)
    wrapper.unmount()
  })
})

describe('H. 前提哨兵：快照属性数据源的覆盖完备性', () => {
  /**
   * 这条**不是**功能断言，是**前提哨兵** —— 钉住 `useUndoHistory.propEnvelope` 的安全性前提。
   *
   * 信封只读 `propertyStore.propertiesByBlock`（不用 DB 兜底，见其注释「为什么信封只读缓存」），
   * 这份数据之所以够用，全靠「页面每个块只要渲染就会被挂载、挂载即**无条件**加载属性」
   * （`useBlockPropertySync.onMounted` → `loadBlockProperties`，后者无条件写缓存）。
   * 这里把该前提变成可执行断言：**页面块集合 ⊆ propertyStore 的键集合**。
   *
   * 会变红的情形（= 该去重新评估「恢复是否还完备」的信号）：
   * - 引入虚拟滚动 / 懒渲染 ⇒ 未渲染的块不挂载 ⇒ 不加载属性；
   * - `useBlockPropertySync` 的加载被改成条件式（如只给特定 type 加载）；
   * - 属性缓存被驱逐（`clearBlockCache` 目前生产零调用）。
   * 真红之后须知：撤销「删块」时那些块的信封属性缺失 ⇒ 该块属性**永久丢失**，
   * 此时才需要动 Rust（让 `undelete_blocks` 顺带复活属性行）。2026-09-15 grill-up 核查结论：
   * 当前不可达（无虚拟滚动、折叠用 display:none 不卸载、缓存零驱逐、删块入口只在 BlockList），
   * 故**未**改 T1 语义、也**未**动 ADR-0046 D10。
   */
  test('页面每个块渲染后其属性条目都进 propertyStore（信封完备性的前提）', async () => {
    const pageId = 'page-envelope-coverage'
    const ids = await seed(pageId, ['a', 'b', 'c'])
    const wrapper = await mountBlockList(pageId)
    await flushAsync()

    const propertyStore = usePropertyStore()
    const pageBlocks = useBlockStore().getBlocksByPage(pageId)
    const missing = pageBlocks.filter((b) => !propertyStore.propertiesByBlock.has(b.id))

    // 夹具自检：三个块确实都进了本页（否则下面的「无缺失」会因空集合而假绿）
    expect(pageBlocks.map((b) => b.id)).toEqual(expect.arrayContaining(ids))
    expect(pageBlocks.length).toBeGreaterThanOrEqual(3)
    // 核心断言：一个都不许漏
    expect(missing.map((b) => b.content)).toEqual([])
    wrapper.unmount()
  })
})
