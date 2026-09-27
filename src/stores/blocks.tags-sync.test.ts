/**
 * _doSave 回写 block.tags 回归测试（covers 输入 block 后字段展示区不刷新的根因）
 *
 * 行为约定：
 * 1. 保存成功后，Rust 派生的 block.tags 必须回写本地 store，否则 BlockTagFields
 *    （读 block.tags）在输入 #tag 后不刷新。
 * 2. 块引用系统任务 tag 且尚无 status 属性 → 自动 ensureTodo（status 任务图标自动展示）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { SAVE_DEBOUNCE_MS } from '../utils/block-helpers'

const hoisted = vi.hoisted(() => {
  const ensureTodo = vi.fn(() => Promise.resolve())
  const getBlockProperty = vi.fn(() => undefined)
  const client = {
    saveBlockTree: vi.fn(),
    executeBatch: vi.fn(() => Promise.resolve()),
    getProperties: vi.fn(() => Promise.resolve([])),
    getOutlinks: vi.fn(() => Promise.resolve([])),
    setProperty: vi.fn(() => Promise.resolve({})),
  }
  return { ensureTodo, getBlockProperty, client }
})

const SYSTEM_TASK_ID = 'sys-tag-system-task'

vi.mock('../wasm/client', () => ({
  initCoreClient: vi.fn(() => Promise.resolve(hoisted.client)),
  isTauriEnvironment: vi.fn(() => false),
}))

vi.mock('../stores/property', () => ({
  usePropertyStore: vi.fn(() => ({
    ensureTodo: hoisted.ensureTodo,
    getBlockProperty: hoisted.getBlockProperty,
  })),
}))

vi.mock('../stores/tags', () => {
  const allTags = [{
    id: 'sys-tag-system-task',
    title: '系统任务',
    field_ids: ['fd-status'],
    parent_id: null,
    description: '',
    color: '',
    is_system: true,
    created_at: 0,
    updated_at: 0,
    version: 1,
    deleted_at: null,
  }]
  const fieldDefs = [{
    id: 'fd-status',
    key: 'status',
    title: '状态',
    type: 'string',
    closed_values: null,
    default_value: null,
    is_system: true,
    created_at: 0,
    updated_at: 0,
    version: 1,
    deleted_at: null,
  }]
  return {
    useTagsStore: vi.fn(() => ({
      allTags,
      // 有效字段：含 key==='status' → 命中系统任务 tag 识别
      effectiveFieldDefinitions: () => fieldDefs,
    })),
  }
})

import { useBlockStore } from './blocks'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  vi.useFakeTimers()
  // 保存结果：沿用传入 block 的 id（避免触发 id 同步分支），并派生 tags
  hoisted.client.saveBlockTree.mockImplementation((updates: { id: string }[]) =>
    Promise.resolve([{ block: { id: updates[0].id, tags: [SYSTEM_TASK_ID] }, render_segments: [] }]),
  )
})

/** 落一个 block，返回其 id */
async function seed(content: string): Promise<string> {
  const blockStore = useBlockStore()
  const block = await blockStore.createBlock({
    pageId: 'p1',
    content,
    pos: 1,
    type: 'bullet',
  })
  return block.id
}

describe('_doSave — 回写 block.tags', () => {
  it('保存成功后本地 block.tags 同步自 Rust 派生结果', async () => {
    const blockStore = useBlockStore()
    const id = await seed('旧内容')

    // 初始无标签
    expect(blockStore.getBlock(id)?.tags ?? []).toEqual([])

    await blockStore.updateBlockContent(id, '新内容 #任务')
    // 推进防抖保存 + 等待异步落库回写
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS)
    await flushPromises()

    // 关键：block.tags 应同步为 save 返回的派生 tags
    expect(blockStore.getBlock(id)?.tags).toEqual([SYSTEM_TASK_ID])
  })

  it('引用系统任务 tag 且无 status → 自动 ensureTodo（status 图标自动展示）', async () => {
    const blockStore = useBlockStore()
    const id = await seed('旧内容')

    await blockStore.updateBlockContent(id, '新内容 #任务')
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS)
    await flushPromises()

    // 内容不含 dateRef → 内联 ensureTodo 不应触发
    expect(hoisted.ensureTodo).toHaveBeenCalledTimes(1)
    expect(hoisted.ensureTodo).toHaveBeenCalledWith(id)
  })

  it('已有 status 属性 → 不再重复 ensureTodo', async () => {
    const blockStore = useBlockStore()
    const id = await seed('旧内容')
    // 模拟该块已有 status 属性
    hoisted.getBlockProperty.mockReturnValue({ id: 'p1', key: 'status', value: 'Todo' })

    await blockStore.updateBlockContent(id, '新内容 #任务')
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS)
    await flushPromises()

    expect(hoisted.ensureTodo).not.toHaveBeenCalled()
  })
})
