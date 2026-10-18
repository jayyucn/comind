/**
 * 字段模板重排推导（纯函数，单测友好）。
 *
 * 标签字段模板的可见列表 = 有效字段（自身 > 父 > 更远祖先，Rust 解析、单源）。其中只有
 * 标签**自身声明**的字段（kind = own / ref，落在 `tag.field_ids` 内）可被用户重排；继承字段
 * （kind = inherited）由父链决定、不在此标签的写权限内。
 *
 * 因此重排只改变 `field_ids` 内字段的相对顺序，继承字段无论被拖到什么位置都按原有效顺序留在
 * 自身组之后（Rust 解析规则保证自身组恒在继承组之前）。本函数从拖拽后的可见序列里抽出
 * own/ref 字段的新相对顺序，作为落库的目标 `field_ids`。
 */
export interface SortableFieldRow {
  def: { id: string }
  kind: 'own' | 'ref' | 'inherited'
}

/**
 * 从拖拽后的可见序列推导落库的 `field_ids`。
 *
 * - 过滤掉继承字段（它们不在本标签的 `field_ids` 内，不能重排）；
 * - 取 own/ref 字段的新相对顺序；
 * - 若结果与当前 `field_ids` 逐项相同，返回原数组引用（调用方据此判定「无变化、跳过落库」）。
 */
export function reorderOwnFieldIds(
  rows: SortableFieldRow[],
  currentFieldIds: string[],
): string[] {
  const ordered = rows.filter((r) => r.kind !== 'inherited').map((r) => r.def.id)
  const unchanged =
    ordered.length === currentFieldIds.length &&
    ordered.every((id, i) => id === currentFieldIds[i])
  return unchanged ? currentFieldIds : ordered
}
