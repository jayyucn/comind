/**
 * inline 原子单元（@date-ref / #tag / [[wiki link]]）插入时的两侧补空格原语。
 *
 * 交互语义（与 extensions/inline-unit-keyboard 的 pad 口径同源）：单元两侧的空格
 * 属于单元一部分。该语义从**创建时刻**就成立——菜单补全插入单元时两侧补空格，
 * 用户随后在缘带上的一次 Backspace 即可整删（含 pad），不必先清悬挂空格。
 *
 * 三处插入路径共用本原语：useDateTimePickerPanel（date-ref 面板确认）、
 * Editor.vue handleTagSelect / handleWikiLinkSelect（补全菜单选择）。
 */

/**
 * 纯字符版补空：unit 两侧按邻字符决定是否补一个空格。
 * - 左侧：块首（null/''）、已有时（' '）、tab/nbsp 等现成分隔 不补；
 *   换行符 \n 在单行渲染（预览/列表）下会塌缩，必须补，否则与上一行内容粘连成 `x@...`
 * - 右侧：行尾（null/''）或紧跟非空白字符 → 补尾随空格；已有时（' '/\n/tab/nbsp）不补
 */
export function padInlineUnit(left: string | null, right: string | null, unit: string): string {
  let padded = unit
  const leftNeedsSpace =
    left !== null && left !== '' && left !== ' ' && left !== '\t' && left !== '\u00A0'
  if (leftNeedsSpace) padded = ` ${padded}`
  if (!right || !/\s/.test(right)) padded = `${padded} `
  return padded
}

/**
 * editor 模式：以 PM doc.textBetween 读取替换区间左右邻字符，给 unit 两侧补空格。
 * 替换与纯插入的"右邻"语义一致——textBetween(to, to+1) 即插入后紧跟的首字符；
 * 边界越界（from=0 / to=docSize）时 textBetween 返回 ''，padInlineUnit 视为块边界处理。
 *
 * 行首细分：from===0 是块首（左邻无内容）→ 不补左；from>0 但 textBetween 跨段落边界
 * 返回 '' 是段首（换行后的行首）→ 按 \n 处理补左，防单行渲染（预览/列表）下换行塌缩
 * 导致单元与上一段内容粘连成 `x@...`。
 */
export function padUnitForDoc(
  doc: { textBetween: (from: number, to: number) => string },
  from: number,
  to: number,
  unit: string
): string {
  const atBlockStart = from === 0
  const leftRaw = from > 0 ? doc.textBetween(from - 1, from) : ''
  const left = atBlockStart ? null : leftRaw === '' ? '\n' : leftRaw
  const right = doc.textBetween(to, to + 1)
  return padInlineUnit(left, right, unit)
}
