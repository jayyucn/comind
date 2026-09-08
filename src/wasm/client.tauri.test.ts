import { describe, test, expect, beforeEach, vi } from 'vitest'

/**
 * Tauri 路径的反序列化契约测试。
 *
 * 背景：Tauri 命令返回 `Result<String, String>`（JSON 文本），前端拿到的是
 * **字符串**，必须自行 parseJsonResult；而 WASM 路径 `to_js_value` 返回的
 * 是已解析对象。历史上 Tauri 路径没有任何测试覆盖（所有测试都走 WASM），
 * 导致 invoke 结果被直接 `.map()` 而线上报「加载失败」——测试却全绿。
 *
 * 这里把 `isTauriEnvironment()` 打成 true，让 `initCoreClient()` 产出
 * TauriClient（该类未导出，只能经工厂拿到），从而覆盖真机那条路径。
 *
 * 陷阱：`tests/setup.ts` 的 beforeAll（initTestCore）在每个测试文件运行前
 * 先把 **WASM client 缓存进 client.ts 模块级 coreClient**（无 mock 环境），
 * initCoreClient 遇缓存即短路返回。因此必须 beforeEach `vi.resetModules()`
 * 驱逐被污染的模块实例，并动态 import 让 client.ts 在 mock 生效后重跑；
 * 静态 import 持有的是陈旧引用，同样失效。
 */
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('./tauri-platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tauri-platform')>()
  return { ...actual, isTauriEnvironment: () => true }
})

/** 清模块缓存后重建 TauriClient；invoke 为当前模块实例的 mock */
async function setupTauriClient() {
  const { initCoreClient } = await import('./client')
  const { invoke } = await import('@tauri-apps/api/core')
  const client = await initCoreClient()
  return { client, invoke: vi.mocked(invoke) }
}

describe('Tauri 客户端 JSON 反序列化', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  test('mock 生效：isTauriEnvironment 恒为 true', async () => {
    const { isTauriEnvironment } = await import('./tauri-platform')
    expect(isTauriEnvironment()).toBe(true)
  })

  test('listIdeasSnapshotMonths：字符串响应解析为数组', async () => {
    const { client, invoke } = await setupTauriClient()
    invoke.mockResolvedValueOnce(JSON.stringify(['2026-09', '2026-08']))

    await expect(client.listIdeasSnapshotMonths()).resolves.toEqual(['2026-09', '2026-08'])
    expect(invoke).toHaveBeenCalledWith('list_ideas_snapshot_months')
  })

  test('listIdeasSnapshotsByMonth：字符串响应解析并 snake→camel 映射', async () => {
    const { client, invoke } = await setupTauriClient()
    invoke.mockResolvedValueOnce(
      JSON.stringify([
        { page_id: 'p1', date: '2026-08-31', content_json: '{"blocks":[]}' },
        { page_id: 'p2', date: '2026-08-30', content_json: '{"blocks":[]}' },
      ])
    )

    await expect(client.listIdeasSnapshotsByMonth(2026, 8)).resolves.toEqual([
      { pageId: 'p1', date: '2026-08-31', content: '{"blocks":[]}' },
      { pageId: 'p2', date: '2026-08-30', content: '{"blocks":[]}' },
    ])
    expect(invoke).toHaveBeenCalledWith('list_ideas_snapshots_by_month', { year: 2026, month: 8 })
  })

  test('getIdeasSnapshot：字符串响应解析为对象', async () => {
    const { client, invoke } = await setupTauriClient()
    invoke.mockResolvedValueOnce(
      JSON.stringify({ content: '{"blocks":[]}', date: '2026-08-31' })
    )

    await expect(client.getIdeasSnapshot('p1')).resolves.toEqual({
      content: '{"blocks":[]}',
      date: '2026-08-31',
    })
    expect(invoke).toHaveBeenCalledWith('get_ideas_snapshot', { pageId: 'p1' })
  })

  test('snapshotStaleIdeasPages：字符串响应解析为对象', async () => {
    const { client, invoke } = await setupTauriClient()
    invoke.mockResolvedValueOnce(JSON.stringify({ materialized: 3 }))

    await expect(client.snapshotStaleIdeasPages()).resolves.toEqual({ materialized: 3 })
  })

  test('回归防护：结果必须是数组而非原始 JSON 字符串', async () => {
    // 若有人移除 parseJsonResult，这里会拿到 string，Array.isArray 将失败。
    const { client, invoke } = await setupTauriClient()
    invoke.mockResolvedValueOnce(JSON.stringify(['2026-09']))

    const months = await client.listIdeasSnapshotMonths()

    expect(Array.isArray(months)).toBe(true)
    expect(months).toHaveLength(1)
  })
})
