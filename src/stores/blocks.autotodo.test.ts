/**
 * updateBlockContent 自动 Todo 行为测试
 *
 * 这是所有写入 content 路径的统一收口（/schedule、/deadline 命令、输入 {{、粘贴等），
 * 因此无论用何种方式写入 schedule/deadline dateRef，block 都应自动成为 Todo 任务。
 *
 * 行为约定：
 * 1. content 含 schedule / deadline dateRef 且 block 无 status → 调用 ensureTodo
 * 2. content 不含 dateRef → 不调用 ensureTodo
 * 3. block 不存在 → 不调用 ensureTodo
 * 4. 移除 dateRef（content 不再含 dateRef）→ 不调用 ensureTodo（保持任务状态，不反向清除）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const hoisted = vi.hoisted(() => {
  const ensureTodo = vi.fn(() => Promise.resolve())
  const client = {
    saveBlockTree: vi.fn(() => Promise.resolve()),
    executeBatch: vi.fn(() => Promise.resolve()),
    getProperties: vi.fn(() => Promise.resolve([])),
    getOutlinks: vi.fn(() => Promise.resolve([])),
    setProperty: vi.fn(() => Promise.resolve({})),
  }
  return { ensureTodo, client }
})

vi.mock('../wasm/client', () => ({
  initCoreClient: vi.fn(() => Promise.resolve(hoisted.client)),
}))

vi.mock('../stores/property', () => ({
  usePropertyStore: vi.fn(() => ({
    ensureTodo: hoisted.ensureTodo,
  })),
}))

import { useBlockStore } from './blocks'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  vi.useFakeTimers()
})

/** 通过 createBlock 落一个 block（提供 pos 跳过位置计算），返回其 id */
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

describe('updateBlockContent — 自动标记 Todo', () => {
  it('content 含 schedule dateRef 且无 status → 调用 ensureTodo', async () => {
    const blockStore = useBlockStore()
    const id = await seed('旧内容')

    await blockStore.updateBlockContent(id, '买牛奶@2026-07-20 📅')

    expect(hoisted.ensureTodo).toHaveBeenCalledTimes(1)
    expect(hoisted.ensureTodo).toHaveBeenCalledWith(id)
  })

  it('content 含 deadline dateRef → 调用 ensureTodo', async () => {
    const blockStore = useBlockStore()
    const id = await seed('旧内容')

    await blockStore.updateBlockContent(id, '交报告@2026-07-25 ⏰')

    expect(hoisted.ensureTodo).toHaveBeenCalledWith(id)
  })

  it('content 不含 dateRef → 不调用 ensureTodo', async () => {
    const blockStore = useBlockStore()
    const id = await seed('旧内容')

    await blockStore.updateBlockContent(id, '普通文本，没有 dateRef')

    expect(hoisted.ensureTodo).not.toHaveBeenCalled()
  })

  it('block 不存在 → 不调用 ensureTodo', async () => {
    const blockStore = useBlockStore()

    await blockStore.updateBlockContent('nope', '@2026-07-20 📅')

    expect(hoisted.ensureTodo).not.toHaveBeenCalled()
  })

  it('移除 dateRef（content 不再含 dateRef）→ 不调用 ensureTodo', async () => {
    const blockStore = useBlockStore()
    const id = await seed('旧内容')

    // 先写入带 dateRef 的内容（触发 ensureTodo）
    await blockStore.updateBlockContent(id, '任务@2026-07-20 📅')
    expect(hoisted.ensureTodo).toHaveBeenCalledTimes(1)

    // 再更新为不含 dateRef 的内容（移除命令）
    hoisted.ensureTodo.mockClear()
    await blockStore.updateBlockContent(id, '任务（已删除日期）')

    // 不应因"移除"而再次调用 ensureTodo（保持原任务状态）
    expect(hoisted.ensureTodo).not.toHaveBeenCalled()
  })
})
