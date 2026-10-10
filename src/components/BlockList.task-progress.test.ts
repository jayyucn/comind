/**
 * BlockList 任务进度条（需求 1-4）+ 父任务状态自动推进（需求 5）
 *
 * 规格锚点：
 * 1. 顶层 block（页面根 block 的子 block）含任务项 → 进度条出现在列表顶部；
 * 2. 任意 block 的子 block 含任务项 → 进度条出现在该 block 下方；
 * 3. Canceled 不参与（不计 total / done）；全 Canceled → 不渲染；
 * 4. 删除最后一个 block（树重建为空）→ 进度条移除；
 * 5. 任务 block 的子任务全部完成 → 本 block 自动置 Done；全部完成后又新建
 *    子任务（存在未完成项）→ 自动改回 Doing；Canceled 父不改写；
 *    含周期 dateRef 的父跳过 Done（防与日期推进机制互踢）。
 *
 * 实现口径：进度条与自动同步均完全由派生逻辑驱动（tree + fieldValueStore），
 * wasm client 以模块级 mock 提供 getFieldValues / setFieldValue（setFieldValue
 * 反写 propsByBlock，模拟落库后 reload 读回，口径照 blocks.autotodo.test.ts）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type { Block } from '../types/block'
import type { Page } from '../types/page'
import type { FieldValue } from '../types/field-value'
import { decodeFieldValueData } from '../utils/field-value-codec'

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

/** 模块级 mock wasm client：getFieldValues 按 block 返回预置字段值；
 *  setFieldValue 反写 propsByBlock（模拟落库后 loadBlockFieldValues 读回新状态）。 */
const hoisted = vi.hoisted(() => {
  const propsByBlock = new Map<string, FieldValue[]>()
  const client = {
    getFieldValues: vi.fn((blockId: string) => Promise.resolve(propsByBlock.get(blockId) ?? [])),
    setFieldValue: vi.fn(
      async (blockId: string, key: string, valueJson: string, valueType: string) => {
        const rows = propsByBlock.get(blockId) ?? []
        const next = rows.filter((r) => r.key !== key)
        next.push({
          id: `fv-${blockId}-${key}`,
          block_id: blockId,
          field_definition_id: '80000000-0000-4000-8000-000000000001',
          value_json: valueJson,
          value_type: valueType,
          seq: 0,
          created_at: 0,
          updated_at: 0,
          version: 0,
          deleted_at: null,
          key,
        })
        hoisted.propsByBlock.set(blockId, next)
        return { id: `fv-${blockId}-${key}` }
      },
    ),
    saveBlockTree: vi.fn(() => Promise.resolve()),
    executeBatch: vi.fn(() => Promise.resolve()),
    getOutlinks: vi.fn(() => Promise.resolve([])),
    getDateRefsByBlock: vi.fn(() => Promise.resolve([])),
    calculateNextRecurrence: vi.fn(() => Promise.resolve('')),
  }
  return { client, propsByBlock }
})
vi.mock('../wasm/client', () => ({
  initCoreClient: vi.fn(() => Promise.resolve(hoisted.client)),
}))

import BlockList from './BlockList.vue'
import { useBlockStore } from '../stores/blocks'
import { useFieldValueStore } from '../stores/fieldValue'
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

/** status 字段值行（key 由 Rust 服务层 join 后填充；mock 直供） */
function statusRow(blockId: string, status: string): FieldValue {
  return {
    id: `fv-${blockId}-${status}`,
    block_id: blockId,
    field_definition_id: '80000000-0000-4000-8000-000000000001',
    value_json: status,
    value_type: 'string',
    seq: 0,
    created_at: 0,
    updated_at: 0,
    version: 0,
    deleted_at: null,
    key: 'status',
  }
}

/** 当前 fieldValueStore 中某 block 的 status 解码值（undefined = 非任务项） */
function statusOf(blockId: string): string | undefined {
  const fv = useFieldValueStore().getBlockFieldValue(blockId, 'status')
  if (!fv) return undefined
  return decodeFieldValueData(fv.value_json, fv.value_type) as string | undefined
}

let mounted: VueWrapper | null = null

async function mountBlockList(pageId: string): Promise<VueWrapper> {
  const wrapper = mount(BlockList, {
    props: { pageId },
    global: stubGlobal,
  })
  mounted = wrapper
  // 等 Block 挂载后的 loadBlockFieldValues（getFieldValues）落定 + 响应式刷新
  await flushPromises()
  await nextTick()
  return wrapper
}

/** 等待自动状态同步的防抖轮次收敛（真实定时器，覆盖 ≥2 个 120ms 防抖窗口） */
async function settleAutoStatus(ms = 400): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
  await flushPromises()
  await nextTick()
}

/** 列表顶部根级进度条 */
const topBar = (wrapper: VueWrapper) => wrapper.find('.block-list-task-progress')
/** 指定 block 下方的子级进度条 */
const childBar = (wrapper: VueWrapper, blockId: string) =>
  wrapper.find(`[data-block-id="${blockId}"] .block-child-task-progress`)

beforeEach(() => {
  setActivePinia(createPinia())
  resetUndoHistory()
  configureUndoHistory({ idleMs: 10 })
  hoisted.propsByBlock.clear()
  vi.clearAllMocks()
})

afterEach(() => {
  if (mounted) {
    mounted.unmount()
    mounted = null
  }
})

/** 种一页：root + 若干顶层 block（root 的子 block） */
function seedPage(pageId: string, topBlocks: Array<[string, string]>): void {
  const store = useBlockStore()
  const pageStore = usePageStore()
  const root = mkBlock(`${pageId}-root`, pageId, null, 0)
  const blocks: Block[] = [root]
  topBlocks.forEach(([id, content], i) => {
    blocks.push(mkBlock(id, pageId, root.id, (i + 1) * 1000, content))
  })
  pageStore.pages = [pageRow(pageId, root.id)]
  store.blocks = blocks
}

/** 种一页：root + parent + 若干 parent 的子任务（status 由 propsByBlock 提供） */
function seedParentWithTasks(pageId: string, parentContent = ''): { parentId: string; taskIds: string[] } {
  const store = useBlockStore()
  const pageStore = usePageStore()
  const root = mkBlock(`${pageId}-root`, pageId, null, 0)
  const parent = mkBlock('parent', pageId, root.id, 1000, parentContent)
  store.blocks = [root, parent]
  pageStore.pages = [pageRow(pageId, root.id)]
  return { parentId: parent.id, taskIds: [] }
}

describe('BlockList 根级任务进度条（需求 2）', () => {
  it('顶层 block 含任务项 → 列表顶部显示 done/total', async () => {
    const pageId = 'p-top-tasks'
    seedPage(pageId, [['a', '任务A'], ['b', '任务B'], ['c', '普通块']])
    hoisted.propsByBlock.set('a', [statusRow('a', 'Done')])
    hoisted.propsByBlock.set('b', [statusRow('b', 'Todo')])

    const wrapper = await mountBlockList(pageId)

    expect(topBar(wrapper).exists()).toBe(true)
    expect(topBar(wrapper).text()).toContain('1/2')
    // 普通块（无 status）不参与
    expect(topBar(wrapper).text()).not.toContain('2/3')
  })

  it('顶层 block 全无任务项 → 不显示进度条', async () => {
    const pageId = 'p-no-tasks'
    seedPage(pageId, [['a', '普通A'], ['b', '普通B']])

    const wrapper = await mountBlockList(pageId)

    expect(topBar(wrapper).exists()).toBe(false)
  })

  it('Canceled 不参与：Done + Canceled → 1/1', async () => {
    const pageId = 'p-canceled'
    seedPage(pageId, [['a', '任务A'], ['b', '任务B']])
    hoisted.propsByBlock.set('a', [statusRow('a', 'Done')])
    hoisted.propsByBlock.set('b', [statusRow('b', 'Canceled')])

    const wrapper = await mountBlockList(pageId)

    expect(topBar(wrapper).exists()).toBe(true)
    expect(topBar(wrapper).text()).toContain('1/1')
  })

  it('全 Canceled → 不显示进度条', async () => {
    const pageId = 'p-all-canceled'
    seedPage(pageId, [['c', '任务C']])
    hoisted.propsByBlock.set('c', [statusRow('c', 'Canceled')])

    const wrapper = await mountBlockList(pageId)

    expect(topBar(wrapper).exists()).toBe(false)
  })

  it('状态变化（Todo → Done）后进度条重算', async () => {
    const pageId = 'p-status-change'
    seedPage(pageId, [['a', '任务A'], ['b', '任务B']])
    hoisted.propsByBlock.set('a', [statusRow('a', 'Todo')])
    hoisted.propsByBlock.set('b', [statusRow('b', 'Todo')])

    const wrapper = await mountBlockList(pageId)
    expect(topBar(wrapper).text()).toContain('0/2')

    // 模拟真实状态切换路径：setFieldValue（mock setFieldValue 反写 + reload）
    const fieldValueStore = useFieldValueStore()
    await fieldValueStore.setFieldValue('a', 'status', 'Done', 'string')
    await nextTick()

    expect(topBar(wrapper).text()).toContain('1/2')
  })
})

describe('BlockList 子级任务进度条（需求 1）', () => {
  it('block 的子 block 含任务项 → 该 block 下方显示进度条', async () => {
    const pageId = 'p-nested'
    const store = useBlockStore()
    const pageStore = usePageStore()
    const root = mkBlock(`${pageId}-root`, pageId, null, 0)
    const parent = mkBlock('parent', pageId, root.id, 1000, '分组')
    const taskA = mkBlock('tA', pageId, parent.id, 1000, '任务A')
    const taskB = mkBlock('tB', pageId, parent.id, 2000, '任务B')
    const other = mkBlock('other', pageId, root.id, 2000, '其他块')
    pageStore.pages = [pageRow(pageId, root.id)]
    store.blocks = [root, parent, taskA, taskB, other]
    hoisted.propsByBlock.set('tA', [statusRow('tA', 'Done')])
    hoisted.propsByBlock.set('tB', [statusRow('tB', 'Doing')])

    const wrapper = await mountBlockList(pageId)

    expect(childBar(wrapper, 'parent').exists()).toBe(true)
    expect(childBar(wrapper, 'parent').text()).toContain('1/2')
    // 无任务子块的块不显示
    expect(childBar(wrapper, 'other').exists()).toBe(false)
    // 顶层无任务（parent/other 均非任务项）→ 列表顶部不显示
    expect(topBar(wrapper).exists()).toBe(false)
  })
})

describe('删除最后一个 block 后进度条移除（需求 4）', () => {
  it('树重建为空 → 根级进度条消失', async () => {
    const pageId = 'p-delete-last'
    seedPage(pageId, [['a', '唯一任务']])
    hoisted.propsByBlock.set('a', [statusRow('a', 'Todo')])

    const wrapper = await mountBlockList(pageId)
    expect(topBar(wrapper).exists()).toBe(true)

    // 删除最后一个 block：store 只剩 root，结构签名 watch 触发树重建 → tree 为空
    const store = useBlockStore()
    store.blocks = store.blocks.filter(b => b.id !== 'a')
    await nextTick()

    expect(topBar(wrapper).exists()).toBe(false)
  })

  it('最后一个任务子块删除 → block 下方进度条消失', async () => {
    const pageId = 'p-delete-last-child'
    const store = useBlockStore()
    const pageStore = usePageStore()
    const root = mkBlock(`${pageId}-root`, pageId, null, 0)
    const parent = mkBlock('parent', pageId, root.id, 1000, '分组')
    const taskA = mkBlock('tA', pageId, parent.id, 1000, '唯一任务')
    pageStore.pages = [pageRow(pageId, root.id)]
    store.blocks = [root, parent, taskA]
    hoisted.propsByBlock.set('tA', [statusRow('tA', 'Todo')])

    const wrapper = await mountBlockList(pageId)
    expect(childBar(wrapper, 'parent').exists()).toBe(true)

    store.blocks = store.blocks.filter(b => b.id !== 'tA')
    await nextTick()

    expect(childBar(wrapper, 'parent').exists()).toBe(false)
  })
})

describe('父任务状态自动推进（需求 5）', () => {
  it('子任务全部完成 → 父任务 block 自动置为 Done', async () => {
    const pageId = 'p-auto-done'
    const store = useBlockStore()
    const pageStore = usePageStore()
    const root = mkBlock(`${pageId}-root`, pageId, null, 0)
    const parent = mkBlock('parent', pageId, root.id, 1000, '分组任务')
    const tA = mkBlock('tA', pageId, parent.id, 1000, '任务A')
    const tB = mkBlock('tB', pageId, parent.id, 2000, '任务B')
    pageStore.pages = [pageRow(pageId, root.id)]
    store.blocks = [root, parent, tA, tB]
    hoisted.propsByBlock.set('parent', [statusRow('parent', 'Todo')])
    hoisted.propsByBlock.set('tA', [statusRow('tA', 'Done')])
    hoisted.propsByBlock.set('tB', [statusRow('tB', 'Done')])

    const wrapper = await mountBlockList(pageId)
    await settleAutoStatus()

    expect(statusOf('parent')).toBe('Done')
    expect(wrapper.find('[data-block-id="parent"]').classes()).toContain('status-done')
  })

  it('全部完成后又新建子任务 → 父任务改回 Doing', async () => {
    const pageId = 'p-auto-doing'
    const store = useBlockStore()
    const pageStore = usePageStore()
    const root = mkBlock(`${pageId}-root`, pageId, null, 0)
    const parent = mkBlock('parent', pageId, root.id, 1000, '分组任务')
    const tA = mkBlock('tA', pageId, parent.id, 1000, '任务A')
    pageStore.pages = [pageRow(pageId, root.id)]
    store.blocks = [root, parent, tA]
    hoisted.propsByBlock.set('parent', [statusRow('parent', 'Todo')])
    hoisted.propsByBlock.set('tA', [statusRow('tA', 'Done')])

    const wrapper = await mountBlockList(pageId)
    await settleAutoStatus()
    expect(statusOf('parent')).toBe('Done')

    // 全部完成后新建子任务（带 status=Todo）→ 父改回进行中
    const tB = mkBlock('tB', pageId, parent.id, 2000, '新任务')
    store.blocks.push(tB)
    hoisted.propsByBlock.set('tB', [statusRow('tB', 'Todo')])
    await settleAutoStatus()

    expect(statusOf('parent')).toBe('Doing')
    expect(wrapper.find('[data-block-id="parent"]').classes()).toContain('status-doing')
  })

  it('Canceled 的父任务不被自动改写', async () => {
    const pageId = 'p-auto-canceled-parent'
    const store = useBlockStore()
    const pageStore = usePageStore()
    const root = mkBlock(`${pageId}-root`, pageId, null, 0)
    const parent = mkBlock('parent', pageId, root.id, 1000, '已取消的任务')
    const tA = mkBlock('tA', pageId, parent.id, 1000, '任务A')
    pageStore.pages = [pageRow(pageId, root.id)]
    store.blocks = [root, parent, tA]
    hoisted.propsByBlock.set('parent', [statusRow('parent', 'Canceled')])
    hoisted.propsByBlock.set('tA', [statusRow('tA', 'Done')])

    await mountBlockList(pageId)
    await settleAutoStatus()

    expect(statusOf('parent')).toBe('Canceled')
  })

  it('含周期 dateRef 的父任务不自动置 Done（防与日期推进机制互踢）', async () => {
    const pageId = 'p-auto-recurring'
    const { parentId } = seedParentWithTasks(pageId, '@2026-10-05 📅|weekly 周例会')
    const store = useBlockStore()
    store.blocks.push(mkBlock('tA', pageId, parentId, 1000, '任务A'))
    hoisted.propsByBlock.set('parent', [statusRow('parent', 'Todo')])
    hoisted.propsByBlock.set('tA', [statusRow('tA', 'Done')])

    await mountBlockList(pageId)
    await settleAutoStatus()

    // 全完成但父带周期 dateRef → 不被强制 Done（保持 Todo）
    expect(statusOf('parent')).toBe('Todo')
  })

  it('无 status 的父 block 不被自动标记为任务', async () => {
    const pageId = 'p-auto-non-task'
    const { parentId } = seedParentWithTasks(pageId, '普通分组')
    const store = useBlockStore()
    store.blocks.push(mkBlock('tA', pageId, parentId, 1000, '任务A'))
    hoisted.propsByBlock.set('tA', [statusRow('tA', 'Done')])

    await mountBlockList(pageId)
    await settleAutoStatus()

    expect(statusOf('parent')).toBeUndefined()
  })
})
