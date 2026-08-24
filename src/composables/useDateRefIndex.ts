/**
 * T12 · useDateRefIndex composable
 *
 * 改造后：内存 DateRefIndex 已废弃。date-ref 索引改为由 comind-core（Rust/SQLite）在
 * block 写入路径（BlockService::create / update / delete）中派生维护，存于 DateRef 表。
 *
 * 本 composable 不再自建 / 自同步索引——索引在写入时自动保持最新。这里只封装对
 * comind-core 的只读查询（queryByDateRange / queryOverdue / queryByDate / getBlockRefs），
 * 供日历视图、逾期红点等消费方使用。
 *
 * 兼容性说明：
 * - build / updateBlock / removeBlock 保留为异步 no-op（索引已自动维护，无需外部驱动）。
 *   · 历史 block 首次打开由 src/main.ts 调用 client.rebuildDateRefs() 全量回填一次。
 *   · block 删除时 DateRef 表由 ON DELETE CASCADE 自动清理。
 * - 对外查询方法签名保持（queryByDateRange / queryOverdue / queryByDate / getBlockRefs），
 *   但改为 async，因为底层走数据库查询。
 */

import { initCoreClient, type CoreClient } from '../wasm/client'
import type { DateRefKind } from '../utils/date-ref'
import type { DateRefRecord } from '../wasm/types'

let clientPromise: Promise<CoreClient> | null = null

function getClient(): Promise<CoreClient> {
  if (!clientPromise) {
    clientPromise = initCoreClient()
  }
  return clientPromise
}

export function useDateRefIndex() {
  /** 索引由 core 在写入时自动维护；此处无需操作（历史回填见 main.ts）。 */
  async function build(_blocks?: unknown): Promise<void> {
    // no-op: indexing is maintained automatically by comind-core on block write.
  }

  /** 自动维护，无需操作。 */
  async function updateBlock(_block: unknown): Promise<void> {
    // no-op
  }

  /** block 删除由 DateRef 表 ON DELETE CASCADE 自动清理，无需操作。 */
  async function removeBlock(_blockId: string): Promise<void> {
    // no-op
  }

  async function queryByDateRange(
    kind: DateRefKind | '*',
    from: string,
    to: string,
  ): Promise<DateRefRecord[]> {
    const client = await getClient()
    return client.queryDateRefs(kind, from, to)
  }

  async function queryOverdue(nowIso?: string): Promise<DateRefRecord[]> {
    const today = (nowIso ?? new Date().toISOString()).slice(0, 10)
    const client = await getClient()
    return client.queryOverdueDateRefs(today)
  }

  async function queryByDate(date: string, kind?: DateRefKind): Promise<DateRefRecord[]> {
    const client = await getClient()
    return client.queryDateRefs(kind ?? '*', date, date)
  }

  async function getBlockRefs(blockId: string): Promise<DateRefRecord[]> {
    const client = await getClient()
    return client.getDateRefsByBlock(blockId)
  }

  return {
    build,
    updateBlock,
    removeBlock,
    queryByDateRange,
    queryOverdue,
    queryByDate,
    getBlockRefs,
  }
}
