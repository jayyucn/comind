/**
 * T12 · date-ref 索引
 *
 * 从所有 block content 中提取 dateRef，构建 `(blockId, kind, iso)` 索引，
 * 支撑日历视图 / 按日期筛选。
 *
 * 数据结构（双 Map）：
 *   byBlock: blockId → DateRef[]     （单 block 更新）
 *   byKind:  kind → (date → Set<blockId>)  （范围查询）
 *
 * 使用示例：
 *   const index = new DateRefIndex()
 *   index.build(allBlocks)
 *   index.update('block-1', newContent)    // 增量更新
 *   index.update('block-1', null)           // 删除
 *   index.queryByDateRange('schedule', '2026-07-01', '2026-07-31')
 *   index.queryOverdue()                     // 逾期 deadline
 */
import { parseDateRefs } from '../utils/date-ref'
import type { DateRef, DateRefKind } from '../utils/date-ref'

export interface IndexEntry {
  blockId: string
  kind: DateRefKind
  iso: string
  recurrence: string
  leadMinutes: number
}

/**
 * 将 DateRef 的 iso 按天截断（忽略时间部分），用于日期范围匹配
 * '2026-07-15'      → '2026-07-15'
 * '2026-07-15T14:00' → '2026-07-15'
 */
function truncateToDay(iso: string): string {
  return iso.slice(0, 10)
}

/**
 * 比较两个日期字符串（YYYY-MM-DD）
 */
function dateCmp(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

export class DateRefIndex {
  /** blockId → DateRef[] */
  private byBlock = new Map<string, DateRef[]>()
  /** kind → date → Set<blockId> */
  private byKind = new Map<DateRefKind, Map<string, Set<string>>>()

  // ── 构建 ────────────────────────────────────────────────────────

  /**
   * 从一组 block 中构建完整的索引。
   * 会清空索引，建议在初始化时调用一次。
   */
  build(blocks: Array<{ id: string; content: string }>): void {
    this.byBlock.clear()
    this.byKind.clear()

    for (const block of blocks) {
      const refs = parseDateRefs(block.content)
      if (refs.length > 0) {
        this.byBlock.set(block.id, refs)
        this.indexRefs(block.id, refs)
      }
    }
  }

  // ── 增量更新 ────────────────────────────────────────────────────

  /**
   * 更新单个 block 的索引。
   * 当 block.content 变更时调用。
   * content 为 null 或空字符串时，从索引中移除该 block。
   */
  update(blockId: string, content: string | null): void {
    // 移除旧索引
    const oldRefs = this.byBlock.get(blockId)
    if (oldRefs) {
      this.unindexRefs(blockId, oldRefs)
      this.byBlock.delete(blockId)
    }

    // 添加新索引
    if (content) {
      const refs = parseDateRefs(content)
      if (refs.length > 0) {
        this.byBlock.set(blockId, refs)
        this.indexRefs(blockId, refs)
      }
    }
  }

  /**
   * 从索引中完全移除一个 block
   */
  remove(blockId: string): void {
    this.update(blockId, null)
  }

  // ── 查询 ────────────────────────────────────────────────────────

  /**
   * 按日期范围查询。
   * @param kind 要查询的类型（或 '*' 表示全部）
   * @param from 起始日期（YYYY-MM-DD，包含）
   * @param to   结束日期（YYYY-MM-DD，包含）
   */
  queryByDateRange(
    kind: DateRefKind | '*',
    from: string,
    to: string,
  ): IndexEntry[] {
    const result: IndexEntry[] = []

    const kinds: DateRefKind[] =
      kind === '*' ? ['schedule', 'deadline'] : [kind]

    for (const k of kinds) {
      const dateMap = this.byKind.get(k)
      if (!dateMap) continue

      for (const [date, blockIds] of dateMap) {
        if (dateCmp(date, from) >= 0 && dateCmp(date, to) <= 0) {
          for (const blockId of blockIds) {
            const refs = this.byBlock.get(blockId)
            if (!refs) continue
            for (const ref of refs) {
              if (ref.kind === k && truncateToDay(ref.iso) === date) {
                result.push({
                  blockId,
                  kind: ref.kind,
                  iso: ref.iso,
                  recurrence: ref.recurrence,
                  leadMinutes: ref.leadMinutes ?? 0,
                })
              }
            }
          }
        }
      }
    }

    // 按日期 + blockId 排序
    result.sort((a, b) => {
      const d = dateCmp(a.iso, b.iso)
      if (d !== 0) return d
      return a.blockId.localeCompare(b.blockId)
    })

    return result
  }

  /**
   * 查询所有逾期的 deadline（今日之前，不含今日）。
   * @param nowIso 当前日期（YYYY-MM-DD），默认从运行环境获取
   */
  queryOverdue(nowIso?: string): IndexEntry[] {
    const today = nowIso ?? new Date().toISOString().slice(0, 10)
    const deadlineMap = this.byKind.get('deadline')
    if (!deadlineMap) return []

    const result: IndexEntry[] = []

    for (const [date, blockIds] of deadlineMap) {
      if (dateCmp(date, today) < 0) {
        for (const blockId of blockIds) {
          const refs = this.byBlock.get(blockId)
          if (!refs) continue
          for (const ref of refs) {
            if (ref.kind === 'deadline' && truncateToDay(ref.iso) === date) {
              result.push({
                blockId,
                kind: ref.kind,
                iso: ref.iso,
                recurrence: ref.recurrence,
                leadMinutes: ref.leadMinutes ?? 0,
              })
            }
          }
        }
      }
    }

    return result.sort((a, b) => a.iso.localeCompare(b.iso))
  }

  /**
   * 获取某一天的 deadline 和 schedule（用于日历视图的单日查询）
   */
  queryByDate(date: string, kind?: DateRefKind): IndexEntry[] {
    return this.queryByDateRange(kind ?? '*', date, date)
  }

  /**
   * 获取某个 block 的所有 dateRef
   */
  getBlockRefs(blockId: string): DateRef[] | undefined {
    return this.byBlock.get(blockId)
  }

  /**
   * 获取所有含 dateRef 的 block ID
   */
  getAllIndexedBlocks(): string[] {
    return [...this.byBlock.keys()]
  }

  /**
   * 获取索引总量
   */
  get size(): number {
    return this.byBlock.size
  }

  // ── 内部方法 ────────────────────────────────────────────────────

  private indexRefs(blockId: string, refs: DateRef[]): void {
    for (const ref of refs) {
      const date = truncateToDay(ref.iso)
      let dateMap = this.byKind.get(ref.kind)
      if (!dateMap) {
        dateMap = new Map()
        this.byKind.set(ref.kind, dateMap)
      }
      let blockIds = dateMap.get(date)
      if (!blockIds) {
        blockIds = new Set()
        dateMap.set(date, blockIds)
      }
      blockIds.add(blockId)
    }
  }

  private unindexRefs(blockId: string, refs: DateRef[]): void {
    for (const ref of refs) {
      const date = truncateToDay(ref.iso)
      const dateMap = this.byKind.get(ref.kind)
      if (!dateMap) continue
      const blockIds = dateMap.get(date)
      if (!blockIds) continue
      blockIds.delete(blockId)
      if (blockIds.size === 0) {
        dateMap.delete(date)
      }
    }
  }
}

/**
 * 工厂函数，快速创建 + 构建。
 * 用于 composable 或组件中的一次性初始化。
 */
export function createDateRefIndex(
  blocks: Array<{ id: string; content: string }>,
): DateRefIndex {
  const index = new DateRefIndex()
  index.build(blocks)
  return index
}
