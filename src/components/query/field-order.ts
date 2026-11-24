import type { FieldDescriptor } from '../../core/query'

/**
 * 字段清单排序：把**当前视图已用的列字段**提到最前（按其列顺序），其余字段保持传入顺序。
 *
 * 查询工具条的四个入口（筛选 FieldSelectMenu / 排序 SortMenu / 分组 GroupMenu / 字段管理
 * FieldManagerPanel 的候选池）共用同一份字段池。注册表原始顺序是全局的，与用户在
 * 本视图配了哪些列无关，于是自定义列会被内置字段挤到列表末尾。此函数只调整呈现顺序，
 * 不改字段集合，也不改任何持久化配置。
 *
 * 纯函数：不修改入参，始终返回新数组（`columnKeys` 为空时也返回新数组，调用方无需判空）。
 */
export function orderFieldsByColumns(
  fields: FieldDescriptor[],
  columnKeys: string[],
): FieldDescriptor[] {
  if (columnKeys.length === 0) return [...fields]

  const rank = new Map(columnKeys.map((key, i) => [key, i]))
  const used: FieldDescriptor[] = []
  const rest: FieldDescriptor[] = []
  for (const field of fields) {
    if (rank.has(field.key)) used.push(field)
    else rest.push(field)
  }
  // 已用字段按列顺序排（columns 是用户拖拽后的权威顺序），未用字段保持传入顺序
  used.sort((a, b) => rank.get(a.key)! - rank.get(b.key)!)
  return [...used, ...rest]
}
