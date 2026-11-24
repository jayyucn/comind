/**
 * 字段引用反链聚合（issue T3 AC4）——纯函数，供 Backlinks.vue 把
 * 「字段值引用了本页」并入反链列表。
 *
 * 背景：后端反链来自 content 解析（Rust content_parse_service 处理 [[X]] 语法），
 * 字段引用值不在 content 里、后端无查询入口——按工单约束采用前端聚合（不动 Rust）。
 *
 * 数据源：fieldValue store 的 `fieldValuesByBlock` 缓存（本会话已加载块的字段值行）。
 * 已知取舍：缓存只含本会话加载过的块，未加载块的字段引用反链本实现看不到；
 * 完整索引需后端按值查询 field_value（Rust 侧新增命令），见工单未尽事项。
 *
 * 判定：value_type==='page' 且解码后值 === 目标页 id（page 为 codec 直通类型，
 * value_json 即 page id 原文）。软删行（deleted_at 非空）不计。
 * 聚合粒度：块级去重——一个块多个字段引用同一页只算一条反链（key 取首个命中）。
 */
import type { FieldValue } from '../types/field-value'
import { decodeFieldValueData } from './field-value-codec'

/** 命中的字段引用反链：引用方块 id + 首个命中的字段 key（展示层可据此标注来源字段）。 */
export interface FieldBacklink {
  blockId: string
  key: string
}

export function extractFieldBacklinks(
  rowsByBlock: Iterable<readonly [string, FieldValue[]]>,
  pageId: string,
): FieldBacklink[] {
  const out: FieldBacklink[] = []
  const seen = new Set<string>()
  if (!pageId) return out
  for (const [blockId, rows] of rowsByBlock) {
    if (seen.has(blockId)) continue
    const hit = rows.find(
      (fv) => !fv.deleted_at
        && fv.value_type === 'page'
        && decodeFieldValueData(fv.value_json, fv.value_type) === pageId,
    )
    if (hit) {
      seen.add(blockId)
      out.push({ blockId, key: hit.key })
    }
  }
  return out
}
