/**
 * force 布局 Web Worker。
 *
 * 背景：G6 v5 在 animation:false 下通过 layout.tick(iterations) 把整段 force 模拟
 * （~300 tick × 每 tick O(n²) 斥力计算）同步跑在主线程，节点数大时单任务可达数十秒，
 * 表现为整个应用无响应（只能杀进程）。本 worker 用同一个 @antv/layout ForceLayout
 * 在子线程完成模拟，主线程只接收终态坐标。
 *
 * 协议：
 *   入：{ id, nodes: [{id}], edges: [{id, source, target}], width, height }
 *   出：{ id, positions: [{id, x, y}] } 或 { id, error: string }
 */
import { ForceLayout } from '@antv/layout'

type WorkerRequest = {
  id: number
  nodes: Array<{ id: string }>
  edges: Array<{ id: string; source: string; target: string }>
  width: number
  height: number
}

type WorkerResponse = {
  id: number
  positions?: Array<{ id: string; x: number; y: number }>
  error?: string
}

type LayoutModel = {
  data(): {
    nodes: Map<string, { id: string; x?: number; y?: number }>
    edges: Map<string, unknown>
  }
}

type LayoutInstance = {
  execute(data: unknown, options: Record<string, unknown>): Promise<void>
  model: LayoutModel
}

// 单例复用（G6 主线程路径同样是单例多次 execute，模拟状态在 restart 时重置）
const layout = new ForceLayout() as unknown as LayoutInstance

const ctx = self as unknown as {
  postMessage(msg: WorkerResponse): void
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null
}

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, nodes, edges, width, height } = e.data
  layout
    .execute(
      { nodes, edges },
      {
        width,
        height,
        preventOverlap: true,
        nodeSize: 100,
        animation: false,
      },
    )
    .then(() => {
      // model.data() 返回 { nodes: Map<id, {id, x, y, ...}> }（坐标由布局直接写在节点上）
      const positions: Array<{ id: string; x: number; y: number }> = []
      layout.model.data().nodes.forEach((n) => {
        positions.push({ id: n.id, x: n.x ?? 0, y: n.y ?? 0 })
      })
      ctx.postMessage({ id, positions })
    })
    .catch((err: unknown) => {
      ctx.postMessage({ id, error: String(err) })
    })
}
