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
 * 三处必要替身（皆为 jsdom 能力缺口，非本功能问题）：
 * 1. `Range.prototype.getClientRects`：块选区一建立就触发高亮层 watcher，jsdom 无此方法
 *    （同 #92，空矩形即可 —— 本文件不验像素）。
 * 2. `window.matchMedia`：import 链中模块级求值会调用（先例：TaskHub.test.ts）。
 * 3. 「编辑态焦点」用注入的合成元素（`div.ProseMirror[contenteditable]` / CodeMirror 形状）
 *    而非真挂 TipTap/CodeMirror —— 本票验的是**按键路由**；「禁用内置历史」由 #109 在
 *    `Editor.vue`（`undoRedo:false`）与 `CodeMirrorEditor.vue`（去 `history()`+`historyKeymap`）
 *    单独钉过，重复挂真编辑器只会引入 jsdom 脆弱性而不增加信号。
 *
 * 已知未覆盖（有意，附理由 —— 别当漏项补）：
 * - `runUndoRedo` 的**退出编辑态**那一步（`deactivateBlock()` + `nextTick()`，借 Editor 卸载时
 *   `onBeforeUnmount` 同步那段未落库文本）在本网**没有等价断言**。要让它有意义必须真挂 TipTap，
 *   而真挂之后 Editor 卸载会把**它自己那份 stale 内容**写回 store、绕过撤销 —— 断言会变假绿。
 *   故本网只从**边界侧**钉住该守卫（见 D 组「编辑态落在别页块上」），该步交真机复核。
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
 * 29 例由全绿转 **28 红 / 1 绿**。唯一未变红的是「别页块进同一 blocks 数组不改本页栈」——
 * 它不检验按键接线，只检验 T2 的逐页归因（对照信号在 T2 自己的单测里，与本文件分工不重叠）。
 * 每条「不接管」用例都自带对照组（同一夹具下 Ctrl+Z 必须被接管），故接线消失时它们也不会
 * 静默通过。
 */
import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll, vi, type MockInstance } from 'vitest'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import BlockList from './BlockList.vue'
import { useBlockStore } from '../stores/blocks'
import { useEditorStore } from '../stores/editor'
import { usePageStore } from '../stores/pages'
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

beforeAll(() => {
  savedGetClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    writable: true,
    value: () => [],
  })
})

afterAll(() => {
  if (savedGetClientRects) Object.defineProperty(Range.prototype, 'getClientRects', savedGetClientRects)
  else delete (Range.prototype as unknown as Record<string, unknown>).getClientRects
})

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

    // 只让「根块」受影响：改它的 format，撤销时恢复集合里便只有根块
    await store.updateBlockFormat(root.id, { collapsed: true })
    await settleStep()

    const ev = undoKey(document.body)
    await flushAsync()

    expect(ev.defaultPrevented).toBe(true)
    expect(store.getBlock(root.id)!.format?.collapsed).toBeFalsy()
    // 受影响块只有根块 ⇒ 过滤后无落点；若不过滤，anchorIds 会含页面根块
    expect(selection.anchorIds.has(root.id)).toBe(false)
    expect(selection.anchorIds.size).toBe(0)
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
