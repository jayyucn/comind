/**
 * 列宽比例分配（ADR-0013 比例模式）。
 *
 * 背景：`table-layout: fixed` 下单元格的 min-width 对列宽无效（CSS 规范：fixed 布局列宽
 * 只由表格宽与列宽声明决定），故「容器压缩到下限后横向滚动」无法用纯 CSS 实现，须由 JS 计算：
 *
 * - 各列宽之和 W = max(预算, 各列下限之和)；
 * - 每列 = 下限 + 剩余空间 × (该列基准宽 - 下限) 的权重；
 * - 预算 > 各列下限之和：各列按权重等比伸缩、铺满无留白（等比例变化）；
 * - 预算 ≤ 各列下限之和：每列停在下限，各列之和 = 下限之和 → 超出外层容器 → 横向滚动；
 * - 逐列取整后用最大余数法分配余量：各列皆为整数、与理论值偏差 ≤ 1px，各列之和恰为 W。
 *
 * 为什么必须返回整数：fixed 布局的表格 used width = max(声明宽, 列宽和 + 表格边框)。
 * 若此处返回浮点、由渲染层逐列四舍五入，小数列会各自进位并累计（实测 11 列 +3px），
 * 令「列宽和 + 描边」超过声明宽 → 表格右缘越出滚动容器可视区 → 右侧描边被裁。
 *
 * @param colPxs    各列基准像素宽（config 显式宽 / 拖拽结果 / 未设宽列 160 兜底），顺序与渲染列一致
 * @param containerWidth 列宽预算（= 表格 border-box 宽 − 表格自身描边，通常即 .table-scroll 的 clientWidth）；
 *                       jsdom 等无布局环境为 0 → 退化为全下限
 * @param minWidth  单列下限（默认 40）
 * @returns 各列渲染像素宽（整数，总和恰为 W，各列与理论值偏差 ≤ 1px）
 */
export function distributeColumnWidths(
  colPxs: number[],
  containerWidth: number,
  minWidth = 40,
): number[] {
  const n = colPxs.length
  if (n === 0) return []
  const minTotal = n * minWidth
  const W = Math.max(Math.round(containerWidth), minTotal)
  const free = Math.max(0, W - minTotal)
  const weights = colPxs.map((px) => Math.max(0, px - minWidth))
  const wSum = weights.reduce((a, b) => a + b, 0)
  const raws = colPxs.map((_, i) => minWidth + (wSum > 0 ? (free * weights[i]) / wSum : free / n))
  // 先全部向下取整，再把余量按小数部分从大到小分配（最大余数法）：各列与理论值偏差 ≤ 1px，
  // 且整数之和恰为 W。若改由末列独自吸收余量，列多时末列会明显偏窄（11 列实测偏窄 3px）。
  const out = raws.map((r) => Math.floor(r))
  const rest = W - out.reduce((a, b) => a + b, 0)
  const byFrac = raws
    .map((r, i) => ({ frac: r - Math.floor(r), i }))
    .sort((a, b) => b.frac - a.frac)
  for (let k = 0; k < rest; k++) out[byFrac[k % n].i] += 1
  return out
}
