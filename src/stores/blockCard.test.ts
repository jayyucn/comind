import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { useBlockCardStore } from './blockCard'

/**
 * 投影脏标记的自动重拉（2026-10-31 真机缺陷回归网）。
 *
 * 缺陷：字段区（BlockFieldZone）改值只经 `fieldValueStore.setFieldValue` 写库 + 调
 * `invalidate` 标脏，从没有人重拉 `cards`；而看板 / 表格 / 日历直接依赖这份投影，
 * 于是改完字段看板停在旧值，必须重进页面才更新。修复把「标脏 → 重拉」收进 store：
 * 合并重拉 + 仅投影被消费过时生效。
 */
const { mockClient } = vi.hoisted(() => {
  const mockClient = {
    getBlockCards: vi.fn(async () => [{ block_id: 'b1' }] as unknown[]),
  }
  return { mockClient }
})

vi.mock('../wasm/client', () => ({
  initCoreClient: vi.fn(() => Promise.resolve(mockClient)),
}))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('useBlockCardStore 脏标记自动重拉', () => {
  test('投影从未加载过时，标脏不做全量查询（纯编辑不为写值付投影查询）', async () => {
    vi.useFakeTimers()
    const store = useBlockCardStore()

    store.invalidate('b1')
    await vi.advanceTimersByTimeAsync(500)

    expect(mockClient.getBlockCards).not.toHaveBeenCalled()
    // 脏标记仍保留：首次 getCards 时照样会重拉
    expect(store.dirtyIds.has('b1')).toBe(true)
  })

  test('投影加载后标脏 → 合并成一次重拉，并清空脏集', async () => {
    vi.useFakeTimers()
    const store = useBlockCardStore()
    await store.load()
    expect(mockClient.getBlockCards).toHaveBeenCalledTimes(1)

    // 一轮内多次标脏（如 status ↔ priority 成对补写）只刷一次
    store.invalidate('b1')
    store.invalidate('b1')
    store.invalidate('b2')
    await vi.advanceTimersByTimeAsync(500)

    expect(mockClient.getBlockCards).toHaveBeenCalledTimes(2)
    expect(store.dirtyIds.size).toBe(0)
  })

  test('全量标脏（无 blockId）同样触发重拉', async () => {
    vi.useFakeTimers()
    const store = useBlockCardStore()
    await store.load()

    store.invalidate()
    expect(store.isFullyDirty).toBe(true)
    await vi.advanceTimersByTimeAsync(500)

    expect(mockClient.getBlockCards).toHaveBeenCalledTimes(2)
    expect(store.isFullyDirty).toBe(false)
  })

  test('重拉失败不清脏，下一次标脏仍会重试', async () => {
    vi.useFakeTimers()
    const store = useBlockCardStore()
    await store.load()

    mockClient.getBlockCards.mockRejectedValueOnce(new Error('ipc down'))
    store.invalidate('b1')
    await vi.advanceTimersByTimeAsync(500)
    expect(store.dirtyIds.has('b1')).toBe(true)

    store.invalidate('b1')
    await vi.advanceTimersByTimeAsync(500)
    expect(store.dirtyIds.size).toBe(0)
    expect(mockClient.getBlockCards).toHaveBeenCalledTimes(3)
  })

  test('加载在飞时让路重排，不与显式 getCards 并发双查', async () => {
    vi.useFakeTimers()
    const store = useBlockCardStore()
    await store.load()

    // 模拟显式重拉（单元格编辑后的 getCards）正在进行
    let release: () => void = () => {}
    mockClient.getBlockCards.mockImplementationOnce(
      () => new Promise((resolve) => {
        release = () => resolve([{ block_id: 'b1' }])
      }) as never,
    )
    const inFlight = store.load()
    store.invalidate('b1')

    // 定时器到点时加载仍在飞 → 让路，不并发再发一次
    await vi.advanceTimersByTimeAsync(200)
    expect(mockClient.getBlockCards).toHaveBeenCalledTimes(2)

    release()
    await inFlight
    // 让路后的重排到点：脏已被那次加载清掉，空转
    await vi.advanceTimersByTimeAsync(500)
    expect(mockClient.getBlockCards).toHaveBeenCalledTimes(2)
  })
})
