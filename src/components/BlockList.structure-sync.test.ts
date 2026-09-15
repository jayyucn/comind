/**
 * BlockList 树同步「结构签名 watch」不变量哨兵（#118，D2）
 *
 * 规格锚点：**树重建正确性不依赖写方纪律** —— 签名读面 = buildTree 的全部输入
 * （id / parentId / pos / pageId / 块对象身份 / 数组身份），不读 content / format /
 * renderSegments。据此参数化断言两组外部行为：
 *
 * 1. 结构写（push / 原地改 parentId / 换对象替换 / 回滚赋值）**即使不 bump
 *    structureVersion** 也必须触发树重建（buildTree 被调用 + DOM 反映 store 真相）。
 *    —— 修前（计数器 watch）：不 bump ⇒ 不重建 ⇒ 红，即 F1（回滚）与 F4（push）的
 *    bug 类本身；修后（签名 watch）：绿。
 * 2. 内容写（content / format / renderSegments 原地 mutate）**不得**触发整树重建
 *    （buildTree 调用数不变）—— 打字流畅性的性能语义哨兵，修前修后都必须绿。
 *
 * 观测口径：
 * - 以 `buildTree` 调用计数为「树重建了没」的 oracle：buildTree 是树重建的唯一原语
 *   （syncFromStore 体内），计数它 = 计数接缝行为本身，不监听 structureVersion 数值
 *   （规格明令：只测外部行为，不测计数器）。模块级 vi.mock 透传包裹，仅本文件生效。
 * - DOM 抽查用户可见真相（`[data-block-id]` / 只读内容文本），走真实渲染路径
 *   （夹具口径照 BlockList.undo-redo.test.ts：mount(BlockList) + VueDraggable passthrough）。
 * - 直接构造 Block / Page 喂 store，**不走 createBlock RPC** —— 本网验的是
 *   「store 写形态 ⇒ 树响应」，落库与 wasm 无涉；也因此内容写用直接 mutate
 *   （同形于 updateBlockContent 体内，但不挂 scheduleSave 防抖，测试无 RPC 尾巴）。
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import type { Block } from '../types/block'
import type { Page } from '../types/page'

// jsdom 无 matchMedia；import 链中模块级求值会调用（先例：BlockList.undo-redo.test.ts）
vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
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

// 「树重建」oracle：透传包裹 buildTree 计数（不 mock 行为，只计数）
const { buildTreeSpy } = vi.hoisted(() => ({
  buildTreeSpy: { count: 0 },
}))
vi.mock('../composables/useBlockTree', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../composables/useBlockTree')>()
  return {
    ...actual,
    buildTree: (...args: Parameters<typeof actual.buildTree>): ReturnType<typeof actual.buildTree> => {
      buildTreeSpy.count++
      return actual.buildTree(...args)
    },
  }
})

import BlockList from './BlockList.vue'
import { useBlockStore } from '../stores/blocks'
import { usePageStore } from '../stores/pages'
import { configureUndoHistory, resetUndoHistory } from '../composables/useUndoHistory'

const stubGlobal = {
  stubs: {
    VueDraggable: { template: '<div><slot /></div>' },
    BlockDropIndicator: true,
  },
}

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

function mkBlock(id: string, pageId: string, parentId: string | null, pos: number, content = ''): Block {
  return { id, pageId, parentId, pos, content, format: {}, type: 'bullet', createdAt: 0, updatedAt: 0 }
}

let mounted: VueWrapper | null = null

async function mountBlockList(pageId: string): Promise<VueWrapper> {
  const wrapper = mount(BlockList, {
    props: { pageId },
    global: stubGlobal,
  })
  mounted = wrapper
  await nextTick()
  return wrapper
}

/** 自 mount 起累计的 buildTree 调用数基线 */
function buildTreeCount(): number {
  return buildTreeSpy.count
}

const renderedIds = (wrapper: VueWrapper): string[] =>
  [...wrapper.element.querySelectorAll<HTMLElement>('[data-block-id]')].map((el) => el.dataset.blockId!)

const renderedText = (wrapper: VueWrapper, blockId: string): string =>
  wrapper.element.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`)?.textContent ?? ''

interface Fixture {
  store: ReturnType<typeof useBlockStore>
  rootId: string
  ids: [string, string]
  snapshot: Block[]
}

/** 种一页两块（root + a + b），mount，返回 store 与回滚用的对象快照 */
async function seedAndMount(pageId: string): Promise<Fixture> {
  const store = useBlockStore()
  const pageStore = usePageStore()
  const root = mkBlock(`${pageId}-root`, pageId, null, 0)
  const a = mkBlock(`${pageId}-a`, pageId, root.id, 1000, 'alpha')
  const b = mkBlock(`${pageId}-b`, pageId, root.id, 2000, 'beta')
  pageStore.pages = [pageRow(pageId, root.id)]
  store.blocks = [root, a, b]
  await mountBlockList(pageId)
  // mount 本身（onMounted → syncFromStore）已调用一次 buildTree，取其后的基线
  expect(buildTreeCount()).toBeGreaterThan(0)
  return { store, rootId: root.id, ids: [a.id, b.id], snapshot: [...store.blocks] }
}

beforeEach(() => {
  setActivePinia(createPinia())
  // 撤销栈是模块级单例：BlockList mount 可能触发 ensureStack，先归零防泄漏（先例同）
  resetUndoHistory()
  configureUndoHistory({ idleMs: 10 })
  buildTreeSpy.count = 0
})

afterEach(() => {
  if (mounted) {
    mounted.unmount()
    mounted = null
  }
})

describe('BlockList 结构签名 watch（#118 D2）—— 结构写必触发树重建', () => {
  test('push 不 bump：新块出现在树与 DOM 中（F4 形态）', async () => {
    const pageId = 'page-sig-push'
    const { store, rootId } = await seedAndMount(pageId)
    const baseline = buildTreeCount()

    // 结构写：直接 push 进 store，不 bump structureVersion
    store.blocks.push(mkBlock('extra', pageId, rootId, 3000, 'gamma'))
    await nextTick()

    expect(buildTreeCount()).toBeGreaterThan(baseline)
    expect(renderedIds(mounted!)).toContain('extra')
  })

  test('原地改 parentId 不 bump：块重新嵌套', async () => {
    const pageId = 'page-sig-reparent'
    const { store, ids } = await seedAndMount(pageId)
    const baseline = buildTreeCount()

    // 结构写：原地 mutate（不换对象、不 bump）—— 树依赖的输入变了，签名必须看见
    const b = store.getBlock(ids[1])!
    b.parentId = ids[0]
    await nextTick()

    expect(buildTreeCount()).toBeGreaterThan(baseline)
  })

  test('原地改 pos 不 bump：结构输入变化触发重建', async () => {
    const pageId = 'page-sig-repos'
    const { store, ids } = await seedAndMount(pageId)
    const baseline = buildTreeCount()

    const b = store.getBlock(ids[1])!
    b.pos = 500 // 排序位置变化 = 结构变化
    await nextTick()

    expect(buildTreeCount()).toBeGreaterThan(baseline)
  })

  test('换对象替换不 bump：树攥新对象，DOM 反映新内容（「失活即消失」bug 类）', async () => {
    const pageId = 'page-sig-replace'
    const { store, ids } = await seedAndMount(pageId)
    const baseline = buildTreeCount()

    // 结构写：整组换新对象（内容同时变化），不 bump —— 现实中的来源是
    // refreshRenderSegments / 恢复快照等「替换而不自知」的路径
    store.blocks = store.blocks.map((b) => ({ ...b, content: b.content + '!' }))
    await nextTick()

    expect(buildTreeCount()).toBeGreaterThan(baseline)
    expect(renderedText(mounted!, ids[0])).toContain('alpha!')
  })

  test('回滚赋值不 bump：树回到回滚对象的内容（F1 形态）', async () => {
    const pageId = 'page-sig-rollback'
    const { store, ids, snapshot } = await seedAndMount(pageId)

    // 先漂移：换上内容不同的副本对象（模拟「树已重建在坏对象上」）
    store.blocks = store.blocks.map((b) => ({ ...b, content: 'drifted' }))
    await nextTick()
    expect(renderedText(mounted!, ids[0])).toContain('drifted')

    // 结构写：回滚赋值（restoreEntry 失败路径同形），不 bump
    const baseline = buildTreeCount()
    store.blocks = [...snapshot]
    await nextTick()

    expect(buildTreeCount()).toBeGreaterThan(baseline)
    expect(renderedText(mounted!, ids[0])).toContain('alpha')
  })
})

describe('BlockList 结构签名 watch（#118 D2）—— 内容写不得触发整树重建', () => {
  test('原地改 content 不触发重建', async () => {
    await seedAndMount('page-sig-content')
    const baseline = buildTreeCount()

    const store = useBlockStore()
    const b = store.blocks[1]
    b.content = 'typed'
    await nextTick()

    expect(buildTreeCount()).toBe(baseline)
  })

  test('原地换 format 不触发重建', async () => {
    await seedAndMount('page-sig-format')
    const baseline = buildTreeCount()

    const store = useBlockStore()
    const b = store.blocks[1]
    b.format = { bold: true }
    await nextTick()

    expect(buildTreeCount()).toBe(baseline)
  })

  test('原地写 renderSegments 不触发重建（refreshRenderSegments 形态）', async () => {
    await seedAndMount('page-sig-segments')
    const baseline = buildTreeCount()

    const store = useBlockStore()
    const b = store.blocks[1]
    b.renderSegments = []
    await nextTick()

    expect(buildTreeCount()).toBe(baseline)
  })
})
