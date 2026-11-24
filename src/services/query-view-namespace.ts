/**
 * 查询块命名空间（per-block `screen_view` 配置）的搬运与孤儿核销。
 *
 * 查询块是**唯一**把视图配置挂进「页面级共享表」`screen_view` 的块类型：命名空间键
 * `query-block:<blockId>` 写在 `entity` 列上。块删除是软删（ADR-0046 D10，可撤销），
 * 所以配置不能在删除那一刻跟着消失 —— 否则 `Ctrl+Z` 把块捞回来后，用户刚拖好的列宽、
 * 筛选条件全是空的，等于「撤销了但没完全撤销」。
 *
 * 三件事分三层：
 * - **标记**（`markQueryViewOrphan`）：块删除时把该命名空间整组改挂 `query-orphan:<blockId>`。
 *   只改归属不改内容，撤销复活后原样可用。
 * - **核销**（`cleanupOrphanQueryViews`）：应用启动后异步跑。撤销栈是会话内内存，重启即空 ⇒
 *   「重启后仍挂着孤儿前缀」就等于「回滚窗口已过」。块仍在则改回（撤销恰好先于重启完成），
 *   块不在则连 Screen 带 Tabs 一并删。
 * - **克隆**（`cloneQueryViewNamespace`）：粘贴查询块副本时把源命名空间整组复制到新块键，
 *   否则复制出来的块会掉回默认三列（用户以为复制漏了东西）。源刚被剪切（配置在孤儿前缀）
 *   时从孤儿前缀读；目标先清空再建（副本挂载时已 seed 了一套默认 Screen+Tab）。
 *
 * 前缀字面量只此一处：Rust 侧两个原语都把前缀当参数收下，不持有命名空间知识。
 */
import type { CoreClient, OrphanCleanupReportRust } from '../wasm/client'
import { initCoreClient } from '../wasm/client'
import type { ScreenViewRust } from '../wasm/types'

/** 活命名空间前缀（块存续期间）。 */
export const QUERY_VIEW_ENTITY_PREFIX = 'query-block:'
/** 孤儿命名空间前缀（块已删除、等待核销）。 */
export const QUERY_VIEW_ORPHAN_PREFIX = 'query-orphan:'

/** 某查询块的命名空间键（`screen_view.entity`）。 */
export function queryViewEntity(blockId: string): string {
  return `${QUERY_VIEW_ENTITY_PREFIX}${blockId}`
}

/** 某查询块的孤儿命名空间键（块已删除，配置暂存在这里等撤销或核销）。 */
export function queryViewOrphanEntity(blockId: string): string {
  return `${QUERY_VIEW_ORPHAN_PREFIX}${blockId}`
}

let clientPromise: Promise<CoreClient | null> | null = null

async function getClient(): Promise<CoreClient | null> {
  if (!clientPromise) clientPromise = initCoreClient()
  return clientPromise
}

/**
 * 块删除时调用：整组改挂孤儿前缀。
 *
 * **故意吞掉失败**：这是删除路径的附带动作，配置清不掉不该让删除本身失败；
 * 漏标的那组会以活前缀留在库里，虽有垃圾但功能无损，下次删除/核销不受影响。
 * 返回改动行数（0 = 该块本就没有落库配置，例如从未打开过）。
 */
export async function markQueryViewOrphan(blockId: string): Promise<number> {
  if (!blockId) return 0
  try {
    const client = await getClient()
    if (!client) return 0
    return await client.markOrphanScreenViews(
      QUERY_VIEW_ENTITY_PREFIX,
      QUERY_VIEW_ORPHAN_PREFIX,
      blockId,
    )
  } catch {
    return 0
  }
}

/**
 * 启动后一次性核销孤儿配置。失败静默（下次启动再试，无累积副作用）。
 */
export async function cleanupOrphanQueryViews(): Promise<OrphanCleanupReportRust> {
  const empty: OrphanCleanupReportRust = { deleted_screens: 0, deleted_tabs: 0, restored: 0 }
  try {
    const client = await getClient()
    if (!client) return empty
    return await client.cleanupOrphanScreenViews(QUERY_VIEW_ORPHAN_PREFIX, QUERY_VIEW_ENTITY_PREFIX)
  } catch {
    return empty
  }
}

/**
 * 块「复活并搬移」后调用（ADR-0025 D4b）：把命名视图从孤儿前缀挂回活前缀。
 *
 * 剪切那一刻 `markQueryViewOrphan` 已经把整组配置改挂到 `query-orphan:<id>`，而搬移原语
 * 只搬 Block 行。不挂回来的话，块重新挂载时 `screenView.load` 读到空命名空间会 seed 一套
 * 默认屏 —— 用户配的视图看起来凭空没了，而启动核销又把孤儿挂回活前缀 ⇒ 同一命名空间两套屏。
 *
 * 与 `markQueryViewOrphan` 同一对前缀、方向相反，所以复用同一个 Rust 原语（前缀是参数）。
 * 返回改动行数（0 = 该块没有落库配置，例如从未打开过）。
 */
export async function restoreQueryViewNamespace(blockId: string): Promise<number> {
  if (!blockId) return 0
  try {
    const client = await getClient()
    if (!client) return 0
    return await client.markOrphanScreenViews(
      QUERY_VIEW_ORPHAN_PREFIX,
      QUERY_VIEW_ENTITY_PREFIX,
      blockId,
    )
  } catch {
    return 0
  }
}

/**
 * 把 `fromBlockId` 的整套命名视图复制到 `toBlockId`。
 *
 * 两级结构要按 Screen → Tab 顺序重建（Tab 的 `parent_id` 指向新 Screen 的 id，不能沿用旧 id）。
 * 顺序即 `sort_order`，原样带过去；`is_default` 不复制 —— 清空目标后第一个新建 Screen 由 Rust
 * 自动置为默认（`create_screen` 的「实体首个 Screen 即默认」不变量），强塞会导致同实体两个默认。
 *
 * 两处「不是照抄」的地方，各有来历：
 * - **源可能是孤儿前缀**：剪切 = 复制 + 删除，删除时 `markQueryViewOrphan` 已把源块整组配置改挂
 *   孤儿前缀。只读活前缀的话，「剪切 → 立刻粘贴」的副本会掉回默认三列（复制 → 粘贴不受影响，
 *   源块还在）。活前缀为空时回退读孤儿前缀。
 * - **目标要先清空**：副本挂载时 `screenView.load` 见该实体无行会 seed 一套默认 Screen+Tab，
 *   而挂载早于粘贴收尾。不清就跟克隆结果叠成两组「查询」（UI 暂时看不见命名视图，纯冗余行，
 *   但等查询块渲染命名视图条的那天就是可见的重复屏）。
 */
export async function cloneQueryViewNamespace(fromBlockId: string, toBlockId: string): Promise<void> {
  if (!fromBlockId || !toBlockId || fromBlockId === toBlockId) return
  try {
    const client = await getClient()
    if (!client) return
    const rows = await readSourceRows(client, fromBlockId)
    if (rows.length === 0) return

    const target = queryViewEntity(toBlockId)
    await clearNamespace(client, target)

    const screenIdMap = new Map<string, string>()
    for (const row of rows.filter((r) => !r.parent_id)) {
      const created = await client.createScreen(
        target,
        row.name,
        row.view_type,
        row.sort_order,
        row.config,
      )
      screenIdMap.set(row.id, created.id)
    }
    for (const row of rows.filter((r) => r.parent_id)) {
      const parentId = screenIdMap.get(row.parent_id)
      if (!parentId) continue
      await client.createTab(
        target,
        parentId,
        row.name,
        row.view_type,
        row.query_json,
        row.sort_order,
        row.config,
      )
    }
  } catch {
    // 克隆失败 ⇒ 新块回退默认配置（与「从未配置过」一致），不影响粘贴本身
  }
}

/** 源命名空间：块还在就取活前缀；刚被剪切掉则配置整组挂在孤儿前缀下。 */
async function readSourceRows(client: CoreClient, blockId: string): Promise<ScreenViewRust[]> {
  const live = await client.getScreenViews(queryViewEntity(blockId))
  if (live.length > 0) return live
  return await client.getScreenViews(queryViewOrphanEntity(blockId))
}

/**
 * 清空某命名空间（供克隆「接管」目标用）：只删 Screen，其下 Tabs 由 `delete_screen` 级联带走
 * （Rust 侧先查同实体子行再逐个删，故不要另行逐条删 Tab —— 撞上已删 id 会抛错，
 * 被外层 catch 吞掉后目标就成了空壳）。
 */
async function clearNamespace(client: CoreClient, entity: string): Promise<void> {
  const stale = await client.getScreenViews(entity)
  for (const row of stale.filter((r) => !r.parent_id)) {
    await client.deleteScreen(row.id)
  }
}
