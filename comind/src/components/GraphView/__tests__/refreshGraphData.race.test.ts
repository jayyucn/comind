import { describe, it, expect } from 'vitest'

/**
 * 复现 GraphView/index.vue 中 refreshGraphData 的竞态条件：
 *
 *   const g = graph ?? graphRef.value
 *   if (!g) return
 *   const { nodes, edges } = await buildGraphData()   // ← await 期间图可能被销毁
 *   if (gen !== refreshGeneration) return              // ← generation 守卫捕获不到 destroy
 *   g.setData({ nodes, edges })                        // ← 对已销毁的 g 调用 → 抛错
 *
 * G6 v5 的 Graph.destroy() 会清空 this.context（this.context = {}），
 * 因此 this.context.model 变为 undefined，setData 内部
 * `this.context.model.setData(...)` 抛出
 * "Cannot read properties of undefined (reading 'setData')"。
 */

// ---- Mock G6 Graph：仅复现与本 bug 相关的语义 ----
class MockG6Graph {
  destroyed = false
  context: { model?: { setData: (d: unknown) => void } } = {
    model: {
      setData: () => {},
    },
  }

  setData(data: unknown): void {
    // 与 @antv/g6 esm/runtime/graph.js:517 行为一致
    this.context.model!.setData(data)
  }

  async draw() {}
  async layout() {}
  async fitView() {}

  destroy(): void {
    // 与 G6 destroy() 一致：清空 context
    this.context = {}
    this.destroyed = true
  }
}

// ---- 复现 SFC 中 refreshGraphData 的逻辑（含 fix 后的 g.destroyed 守卫）----
// 通过 USE_DESTROYED_GUARD 开关，可在测试中切换 fix 前后的行为
async function refreshGraphDataLike(
  g: MockG6Graph | null,
  buildData: () => Promise<{ nodes: unknown[]; edges: unknown[] }>,
  opts: { useDestroyedGuard: boolean },
): Promise<void> {
  if (!g) return
  // 注意：SFC 中此处捕获 g 到局部变量，后续 await 期间外部 destroy() 不会改变该引用
  const { nodes, edges } = await buildData()
  if (opts.useDestroyedGuard && g.destroyed) return
  g.setData({ nodes, edges })
  await g.draw()
  await g.layout()
}

describe('refreshGraphData 竞态条件 — destroyed graph 守卫', () => {
  it('没有守卫时：await 期间 destroy 会导致 setData 抛错（复现 bug）', async () => {
    const g = new MockG6Graph()
    const buildData = async () => {
      // 模拟 await 期间组件卸载或 initGraph 重入 → destroy()
      g.destroy()
      return { nodes: [], edges: [] }
    }

    await expect(
      refreshGraphDataLike(g, buildData, { useDestroyedGuard: false }),
    ).rejects.toThrow(/Cannot read properties of undefined \(reading 'setData'\)/)
  })

  it('有守卫时：await 期间 destroy 不会抛错（验证 fix）', async () => {
    const g = new MockG6Graph()
    const buildData = async () => {
      g.destroy()
      return { nodes: [], edges: [] }
    }

    await expect(
      refreshGraphDataLike(g, buildData, { useDestroyedGuard: true }),
    ).resolves.toBeUndefined()

    expect(g.destroyed).toBe(true)
  })

  it('正常流程（未 destroy）仍然调用 setData', async () => {
    const g = new MockG6Graph()
    let called = false
    g.context.model!.setData = () => { called = true }

    await refreshGraphDataLike(
      g,
      async () => ({ nodes: [{ id: 'a' }], edges: [] }),
      { useDestroyedGuard: true },
    )

    expect(called).toBe(true)
  })
})
