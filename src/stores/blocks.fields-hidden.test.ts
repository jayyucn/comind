/**
 * 块字段区隐藏态持久化测试（ADR-0050 D21 决策 3）。
 *
 * 行为约定：fieldsHidden 与折叠态同通道 —— 唯一权威 = block.format.fields_hidden
 * （format JSON），读写走 updateBlockFormat 合并落库；不引入独立列。
 * 验证：合并写入不冲掉同在 format 里的折叠标志；保存 payload 原样携带 JSON。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { SAVE_DEBOUNCE_MS } from '../utils/block-helpers'

const hoisted = vi.hoisted(() => {
  const client = {
    saveBlockTree: vi.fn(),
    executeBatch: vi.fn(() => Promise.resolve()),
    getFieldValues: vi.fn(() => Promise.resolve([])),
    getOutlinks: vi.fn(() => Promise.resolve([])),
  }
  return { client }
})

vi.mock('../wasm/client', () => ({
  initCoreClient: vi.fn(() => Promise.resolve(hoisted.client)),
  isTauriEnvironment: vi.fn(() => false),
}))

vi.mock('../stores/fieldValue', () => ({
  useFieldValueStore: vi.fn(() => ({
    ensureTodo: vi.fn(() => Promise.resolve()),
    getBlockFieldValue: vi.fn(() => undefined),
    loadBlockFieldValues: vi.fn(() => Promise.resolve([])),
  })),
}))

vi.mock('../stores/tags', () => ({
  useTagsStore: vi.fn(() => ({
    allTags: [],
    effectiveFieldDefinitions: () => [],
  })),
}))

import { useBlockStore } from './blocks'

const BLOCK_ID = 'b-fields'

function seedBlock(store: ReturnType<typeof useBlockStore>) {
  store.blocks.push({
    id: BLOCK_ID,
    pageId: 'p1',
    parentId: null,
    pos: 0,
    content: '带标签的块',
    type: 'text',
    format: { collapsed: false },
    tags: ['t1'],
    children: [],
    createdAt: 1,
    updatedAt: 1,
    version: 0,
  } as never)
}

describe('block.format.fieldsHidden（块字段区隐藏态，D21 决策 3）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers()
    hoisted.client.saveBlockTree.mockImplementation((updates: { id: string }[]) =>
      Promise.resolve([{ block: { id: updates[0].id }, render_segments: [] }]),
    )
  })

  it('updateBlockFormat 写入 fields_hidden，且不冲掉同在 format 里的折叠标志', async () => {
    const store = useBlockStore()
    seedBlock(store)

    await store.updateBlockFormat(BLOCK_ID, { fields_hidden: true })
    await flushPromises()

    const block = store.blocks.find((b) => b.id === BLOCK_ID)!
    expect(block.format.fields_hidden).toBe(true)
    expect(block.format.collapsed).toBe(false)
  })

  it('保存 payload 的 format JSON 原样携带 fields_hidden', async () => {
    const store = useBlockStore()
    seedBlock(store)

    await store.updateBlockFormat(BLOCK_ID, { fields_hidden: true })
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 10)
    await flushPromises()

    expect(hoisted.client.saveBlockTree).toHaveBeenCalled()
    const payload = hoisted.client.saveBlockTree.mock.calls[0][0] as { id: string; format: string }[]
    const saved = payload.find((u) => u.id === BLOCK_ID)!
    expect(JSON.parse(saved.format)).toEqual({ collapsed: false, fields_hidden: true })
  })
})
