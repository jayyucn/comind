/**
 * 枚举字段候选值解析（单选 / 多选字段的选项录入单源）。
 *
 * 入口有两处：标签管理页「+ 添加字段」的新建表单、字段设置弹窗的选项编辑。
 * 两处都必须接受同一套切分规则，否则刚在弹窗里批量粘好的选项，换个入口又变成
 * 一个超长字符串。
 *
 * 切分规则（面向「从别处直接复制粘贴」）：
 * - 分隔符：`,` `，` `、` `;` `；` `|` `/` 换行 制表符 —— 命中任一即切开；
 * - 行首列表标记（`- ` `* ` `• ` `1. ` `1、` `1) `）随行剥掉，避免选项名带上编号；
 * - **不按空格切分**：选项常含空格（`待 定` / `In Progress`），按空格切会碎词。
 *
 * 空格是刻意排除项：`/` 也会切开 URL 形式的选项，取舍是「复制列表的便利」优先于
 * 「选项里带斜杠」的少数场景。
 */

/** 行分隔符：换行 / 制表符（从表格、列表复制时最常见的两种行界限）。 */
const LINE_RE = /[\r\n\t]+/

/** 行内分隔符集合（连续命中视为一个）。空格不在此列，见文件头说明。 */
const SEPARATOR_RE = /[,，、;；|/]+/

/**
 * 行首列表标记：无序（`- * • ·`）或有穷举编号（`1.` `1、` `1)`）。
 * 数字编号带 `(?!\d)` 前瞻，避免把 `1.5万` 啃成 `5万`。
 */
const LIST_MARKER_RE = /^\s*(?:[-*•·]+\s*|\d+[.、)](?!\d)\s*)/

/**
 * 候选值文本 → 选项数组。
 *
 * 先按行切、剥掉行首列表标记，再按行内分隔符切 —— 顺序不能反：`2、周二` 里的顿号
 * 既是编号分隔也可能是选项分隔，先剥标记才不会多出一个「2」。
 *
 * @param raw      原始文本（可多行、可混合分隔符）
 * @param existing 已有选项；结果与它按「保序去重」合并，便于增量追加
 * @returns 已去首尾空白、丢弃空项、与 existing 无重复的选项数组（可能是空数组）
 */
export function parseFieldOptions(raw: string, existing: readonly string[] = []): string[] {
  const merged = [...existing]
  for (const line of raw.split(LINE_RE)) {
    for (const piece of line.replace(LIST_MARKER_RE, '').split(SEPARATOR_RE)) {
      const value = piece.trim()
      if (value && !merged.includes(value)) merged.push(value)
    }
  }
  return merged
}
