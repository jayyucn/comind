/**
 * updateBlockFormat 的 format 合并语义。
 *
 * 行为约定：format 是同一列里的 JSON 键值包（`Record<string, unknown>`），单键写入必须
 * **合并**而非覆盖 —— 同列内其它键（折叠标志、图片对齐、代码语言……）不得被冲掉；
 * 落库 payload 原样携带合并后的 JSON。
 *
 * 本文件承接已废弃特征 `block.format.fields_hidden`（块字段区隐藏态，ADR-0050 D21 决策 3/8）
 * 的持久化测试：该特征已废弃（字段带显隐并入块折叠，ADR-0045 折叠范围扩展），
 * 其中与被废弃键无关的合并断言改用 `collapsed` 承载。
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

const BLOCK_ID = 'b-format'

function seedBlock(store: ReturnType<typeof useBlockStore>) {
  store.blocks.push({
    id: BLOCK_ID,
    pageId: 'p1',
    parentId: null,
    pos: 0,
    content: '带 format 的块',
    type: 'text',
    format: { collapsed: false, align: 'center' },
    children: [],
    createdAt: 1,
    updatedAt: 1,
    version: 0,
  } as never)
}

describe('updateBlockFormat（format 合并语义）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers()
    hoisted.client.saveBlockTree.mockImplementation((updates: { id: string }[]) =>
      Promise.resolve([{ block: { id: updates[0].id }, render_segments: [] }]),
    )
  })

  it('单键写入合并而非覆盖：不冲掉同在 format 里的其它键', async () => {
    const store = useBlockStore()
    seedBlock(store)

    await store.updateBlockFormat(BLOCK_ID, { collapsed: true })
    await flushPromises()

    const block = store.blocks.find((b) => b.id === BLOCK_ID)!
    expect(block.format.collapsed).toBe(true)
    expect(block.format.align).toBe('center')
  })

  it('保存 payload 的 format JSON 原样携带合并后的键值包', async () => {
    const store = useBlockStore()
    seedBlock(store)

    await store.updateBlockFormat(BLOCK_ID, { collapsed: true })
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 10)
    await flushPromises()

    expect(hoisted.client.saveBlockTree).toHaveBeenCalled()
    const payload = hoisted.client.saveBlockTree.mock.calls[0][0] as { id: string; format: string }[]
    const saved = payload.find((u) => u.id === BLOCK_ID)!
    expect(JSON.parse(saved.format)).toEqual({ collapsed: true, align: 'center' })
  })
})
