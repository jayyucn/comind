/**
 * 主线程侧的 force worker 桥接。
 *
 * 用法：computeForceLayoutInWorker(nodes, edges, width, height) 返回终态坐标数组；
 * 任何失败（worker 创建失败 / 执行报错 / 超时）都 resolve(null)，由调用方回退到
 * G6 原生的主线程布局路径——保证功能不因 worker 而中断，只是可能变卡。
 */
export type ForcePosition = { id: string; x: number; y: number }

type WorkerRequest = {
  id: number
  nodes: Array<{ id: string }>
  edges: Array<{ id: string; source: string; target: string }>
  width: number
  height: number
}

type WorkerResponse = {
  id: number
  positions?: ForcePosition[]
  error?: string
}

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, (res: WorkerResponse) => void>()

function ensureWorker(): Worker | null {
  if (worker) return worker
  try {
    worker = new Worker(new URL('./forceWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const entry = pending.get(e.data.id)
      if (!entry) return
      pending.delete(e.data.id)
      entry(e.data)
    }
    // onerror 不终结 worker：让单个请求走超时兜底并回退
    worker.onerror = () => {}
  } catch (err) {
    console.warn('[GraphView] force worker unavailable, fallback to main-thread layout:', err)
    worker = null
  }
  return worker
}

export function computeForceLayoutInWorker(
  nodes: Array<{ id: string }>,
  edges: Array<{ id: string; source: string; target: string }>,
  width: number,
  height: number,
  timeoutMs = 20000,
): Promise<ForcePosition[] | null> {
  const w = ensureWorker()
  if (!w) return Promise.resolve(null)
  const id = ++seq
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      pending.delete(id)
      console.warn('[GraphView] force worker timed out, fallback to main-thread layout')
      resolve(null)
    }, timeoutMs)
    pending.set(id, (res) => {
      window.clearTimeout(timer)
      if (res.error) {
        console.warn('[GraphView] force worker failed, fallback to main-thread layout:', res.error)
        resolve(null)
      } else {
        resolve(res.positions ?? [])
      }
    })
    w.postMessage({ id, nodes, edges, width, height } satisfies WorkerRequest)
  })
}
