/**
 * 自增编号生成（issue T12 autonumber）。
 *
 * 语义：某 key 的 autonumber 字段在**首次写入**时取值 = 该 key 现存最大值 + 1（无则 1）。
 * 唯一性在「已加载数据集」内保证——扫描所有字段值行取该 key 的当前最大编号。
 *
 * 纯函数单源：store 把 `fieldValuesByBlock` 全部行摊平后传入本函数；不依赖 wasm/pinia，
 * 便于单测。重入（同会话并发创建同 key）的边缘碰撞交由「首次写入才生成」的调用约定兜底。
 */
import type { FieldValue } from '../types/field-value'
import { decodeFieldValueData } from './field-value-codec'

/**
 * 计算某 key 的下一个自增编号。
 * @param allRows 全部字段值行（跨块摊平）
 * @param key 目标字段 key
 * @returns 现存最大值 +1；该 key 无任何 autonumber 行时返回 1
 */
export function computeNextAutonumber(allRows: FieldValue[], key: string): number {
  let max = 0
  let found = false
  for (const row of allRows) {
    if (row.key !== key) continue
    if (row.value_type !== 'autonumber') continue
    const decoded = decodeFieldValueData(row.value_json, 'autonumber')
    const n = typeof decoded === 'number' ? decoded : Number(decoded)
    if (Number.isFinite(n)) {
      found = true
      if (n > max) max = n
    }
  }
  return found ? max + 1 : 1
}

/**
 * 从按块分组的缓存中取出某 key 的下一个编号（store 调用入口）。
 * @param byBlock `fieldValuesByBlock` 缓存（Map<blockId, FieldValue[]>）
 * @param key 目标字段 key
 */
export function nextAutonumberFromCache(
  byBlock: Map<string, FieldValue[]>,
  key: string,
): number {
  const all: FieldValue[] = []
  for (const rows of byBlock.values()) all.push(...rows)
  return computeNextAutonumber(all, key)
}
