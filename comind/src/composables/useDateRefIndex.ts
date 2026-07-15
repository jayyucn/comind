/**
 * T12 · useDateRefIndex composable
 *
 * 桥接 DateRefIndex ↔ Pinia block store：
 * - 初始化时从 blocks 构建索引
 * - 监听块变更（由外部在 updateBlockContent/deleteBlock 处触发同步）
 *
 * 生命周期：
 *   应用启动 → useDateRefIndex() → index.build(allBlocks)
 *   block 变更 → watchBlockChange(blockId) → index.update()
 *   日历页面 → ref.value.queryByDateRange(...)
 */
import { ref, computed, type Ref } from 'vue'
import { DateRefIndex, type IndexEntry } from '../storage/date-ref-index'
import { useBlockStore } from '../stores/blocks'
import type { DateRefKind } from '../utils/date-ref'

export function useDateRefIndex() {
  const blockStore = useBlockStore()
  const index = new DateRefIndex()

  /**
   * 从 block store 中构建索引。
   * 应该在应用启动时或 blocks 列表发生大规模变更时调用。
   */
  function build(): void {
    index.build(blockStore.blocks.map(b => ({ id: b.id, content: b.content })))
  }

  /**
   * 增量更新单个 block 的索引。
   * 在 block.content 变更后调用。
   */
  function updateBlock(blockId: string): void {
    const block = blockStore.blocks.find(b => b.id === blockId)
    index.update(blockId, block?.content ?? null)
  }

  /**
   * 从索引中移除某个 block。
   * 在 block 被删除后调用。
   */
  function removeBlock(blockId: string): void {
    index.remove(blockId)
  }

  // ── 响应式查询结果 ──────────────────────────────────────────────

  /** 当前索引数量 */
  const indexedCount = computed(() => index.size)

  /**
   * 按日期范围查询
   */
  function queryByDateRange(
    kind: DateRefKind | '*',
    from: string,
    to: string,
  ): IndexEntry[] {
    return index.queryByDateRange(kind, from, to)
  }

  /**
   * 查询逾期 deadline
   */
  function queryOverdue(nowIso?: string): IndexEntry[] {
    return index.queryOverdue(nowIso)
  }

  /**
   * 查询单日
   */
  function queryByDate(date: string, kind?: DateRefKind): IndexEntry[] {
    return index.queryByDate(date, kind)
  }

  /**
   * 获取某个 block 的 dateRef
   */
  function getBlockRefs(blockId: string) {
    return index.getBlockRefs(blockId)
  }

  return {
    index,
    build,
    updateBlock,
    removeBlock,
    indexedCount,
    queryByDateRange,
    queryOverdue,
    queryByDate,
    getBlockRefs,
  }
}
