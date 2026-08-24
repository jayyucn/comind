/**
 * 列宽比例分配（ADR-0013 比例模式）。
 *
 * 背景：`table-layout: fixed` 下单元格的 min-width 对列宽无效（CSS 规范：fixed 布局列宽
 * 只由表格宽与列宽声明决定），故「容器压缩到下限后横向滚动」无法用纯 CSS 实现，须由 JS 计算：
 *
 * - 表格渲染宽 W = max(容器宽, 各列下限之和)；
 * - 每列 = 下限 + 剩余空间 × (该列基准宽 - 下限) 的权重；
 * - 容器宽 > 各列下限之和：各列按权重等比伸缩、铺满无留白（等比例变化）；
 * - 容器宽 ≤ 各列下限之和：每列停在下限，表格宽 = 下限之和 → 超出容器 → 外层横向滚动；
 * - 末列吸收舍入/浮点误差，保证各列之和恰为 W。
 *
 * @param colPxs    各列基准像素宽（config 显式宽 / 拖拽结果 / 未设宽列 160 兜底），顺序与渲染列一致
 * @param containerWidth 表格容器（.table-scroll）当前宽度；jsdom 等无布局环境为 0 → 退化为全下限
 * @param minWidth  单列下限（默认 40）
 * @returns 各列渲染像素宽（浮点，末列已吸收误差，总和恰为 W）
 */
export function distributeColumnWidths(
  colPxs: number[],
  containerWidth: number,
  minWidth = 40,
): number[] {
  const n = colPxs.length
  if (n === 0) return []
  const minTotal = n * minWidth
  const W = Math.max(containerWidth, minTotal)
  const free = Math.max(0, W - minTotal)
  const weights = colPxs.map((px) => Math.max(0, px - minWidth))
  const wSum = weights.reduce((a, b) => a + b, 0)
  const out: number[] = []
  let used = 0
  for (let i = 0; i < n; i++) {
    let w = minWidth + (wSum > 0 ? (free * weights[i]) / wSum : free / n)
    if (i === n - 1) w = W - used // 末列吸收误差
    out.push(w)
    used += w
  }
  return out
}
