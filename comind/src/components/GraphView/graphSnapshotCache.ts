import type { TauriGraphEdgeRecord } from '../../wasm/tauri-client'
import { tauriBuildGraphSnapshot } from '../../wasm/tauri-client'

// 图谱全量边快照的进程级缓存。
//
// 排障背景（2026-08-13）：build_graph_snapshot 的 Rust 查询本身仅 ~14ms，
// 但「导航时才发 IPC」会让这次调用撞上并发 G6 画布渲染占用的主线程 / IPC 回应路径，
// 导致图谱数据晚 ~1~2.8s 才填充（页面本身早已可交互、不卡死）。
//
// 修复：app 启动（App.vue onMounted）预取一次存入此缓存，之后导航到 /graph 直接命中缓存，
// 画布即时填充。命中缓存后仍后台刷新，保证用户编辑链接后数据新鲜。

let cachedEdges: TauriGraphEdgeRecord[] | null = null
let inflight: Promise<TauriGraphEdgeRecord[]> | null = null

export function getCachedGraphEdges(): TauriGraphEdgeRecord[] | null {
  return cachedEdges
}

async function fetchEdges(): Promise<TauriGraphEdgeRecord[]> {
  return tauriBuildGraphSnapshot()
}

/** app 启动时调用：提前取好快照，fire-and-forget。 */
export function prefetchGraphSnapshot(): void {
  if (cachedEdges || inflight) return
  inflight = fetchEdges()
    .then((edges) => {
      cachedEdges = edges
      return edges
    })
    .finally(() => {
      inflight = null
    })
  void inflight
}

/** 供 GraphPage 使用：命中缓存即返回，否则当场取并缓存（首次/缓存失效时）。 */
export async function getOrFetchGraphEdges(): Promise<TauriGraphEdgeRecord[]> {
  if (cachedEdges) return cachedEdges
  if (inflight) return inflight
  const edges = await fetchEdges()
  cachedEdges = edges
  return edges
}

/** 命中缓存后后台刷新，保证数据新鲜（用户编辑链接后及时反映）。 */
export function refreshGraphSnapshotCache(): void {
  void fetchEdges()
    .then((edges) => {
      cachedEdges = edges
    })
    .catch(() => {
      // 刷新失败不影响已有缓存
    })
}
