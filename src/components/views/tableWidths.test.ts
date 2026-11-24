import { describe, it, expect } from 'vitest'
import { distributeColumnWidths } from './tableWidths'

describe('distributeColumnWidths (比例模式，ADR-0013)', () => {
  it('splits evenly when all baselines are equal', () => {
    // [160,160,160] @1000：minTotal=120, free=880, 权重相等 → 40+880/3≈333.33；取整后余量按小数分配
    const out = distributeColumnWidths([160, 160, 160], 1000)
    expect(out.every(Number.isInteger)).toBe(true)
    expect(out.reduce((a, b) => a + b, 0)).toBe(1000)
    for (const w of out) expect(Math.abs(w - 1000 / 3)).toBeLessThanOrEqual(1)
  })

  it('allocates leftover space by (baseline - min) weight', () => {
    // [300,100] @1000：weights=[260,60] → col0=40+920×260/320=787.5
    const out = distributeColumnWidths([300, 100], 1000)
    expect(out.every(Number.isInteger)).toBe(true)
    expect(out.reduce((a, b) => a + b, 0)).toBe(1000)
    expect(Math.abs(out[0] - 787.5)).toBeLessThanOrEqual(1)
    expect(Math.abs(out[1] - 212.5)).toBeLessThanOrEqual(1)
  })

  it('scales equal-baseline columns strictly proportionally as the container grows', () => {
    const a = distributeColumnWidths([160, 160, 160], 500)
    const b = distributeColumnWidths([160, 160, 160], 1000)
    expect(b[0] / a[0]).toBeCloseTo(2, 1)
  })

  it('keeps the weighted share ratio constant as the container changes', () => {
    // 权重部分 (w - min) / free 恒定：容器 500→1000 时 free 420→920
    // 容差放宽到 1 位：整数化会带来 ≤1px 的取整偏差，比例随之有约 ±0.02 的波动
    const a = distributeColumnWidths([300, 100], 500)
    const b = distributeColumnWidths([300, 100], 1000)
    expect((b[0] - 40) / 920).toBeCloseTo((a[0] - 40) / 420, 1)
    expect((b[1] - 40) / 920).toBeCloseTo((a[1] - 40) / 420, 1)
  })

  it('pins every column at the minimum and overflows when the container is below the min total', () => {
    // [300,100] @60：minTotal=80 > 60 → 表格宽 80（> 容器）→ 外层横向滚动
    const out = distributeColumnWidths([300, 100], 60)
    expect(out).toEqual([40, 40])
    expect(out.reduce((a, b) => a + b, 0)).toBe(80)
  })

  it('never squeezes a column below the minimum', () => {
    const out = distributeColumnWidths([300, 100], 150)
    for (const w of out) expect(w).toBeGreaterThanOrEqual(40)
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(150, 0)
  })

  it('returns integers summing exactly to the budget even when many columns round up', () => {
    // 复现 tag 聚合页的溢出：11 列 / 预算 1248 / 基准 [390,100,85×9]（真机实测值）。
    // 浮点理论值是 386.12 / 99.53 / 84.71×9，浮点和恰为 1248；但渲染层逐列四舍五入后为
    // 386 + 100 + 85×9 = 1251 → fixed 布局 used width = max(声明宽 1250, 1251+2) = 1253
    // → 表格右缘越出 .table-scroll（overflow: auto）可视区 3px → 右侧描边被裁（左侧仍在）。
    const out = distributeColumnWidths([390, 100, ...Array<number>(9).fill(85)], 1248, 60)
    expect(out.every(Number.isInteger)).toBe(true)
    expect(out.reduce((a, b) => a + b, 0)).toBe(1248)
    // 各列与理论值偏差 ≤ 1px：不允许任何一列独自吸收全部余量（曾把末列压到 82px）
    const raws = [386.11764705882354, 99.52941176470588, ...Array<number>(9).fill(84.70588235294117)]
    out.forEach((w, i) => expect(Math.abs(w - raws[i])).toBeLessThanOrEqual(1))
  })

  it('never overshoots the budget for any column count or baseline mix (deterministic fuzz)', () => {
    // 不变量：整数列宽和恰为 W、各列 ≥ 下限 —— 对任意列数与基准宽组合都成立。
    // 定 seed，失败可复现。
    let seed = 20260923
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    for (let iter = 0; iter < 2000; iter++) {
      const n = 1 + Math.floor(rnd() * 24)
      const budget = Math.floor(rnd() * 1800)
      const min = 40 + Math.floor(rnd() * 30)
      const colPxs = Array.from({ length: n }, () => 30 + Math.floor(rnd() * 400))
      const out = distributeColumnWidths(colPxs, budget, min)
      const W = Math.max(Math.round(budget), n * min)
      const sum = out.reduce((a, b) => a + b, 0)
      const detail = { iter, n, budget, min, colPxs, out, sum, W }
      expect(`#${iter} n=${n} budget=${budget} min=${min} sum=${sum} W=${W}`).toBe(
        `#${iter} n=${n} budget=${budget} min=${min} sum=${W} W=${W}`,
      )
      expect(out.every((w) => Number.isInteger(w) && w >= min), JSON.stringify(detail)).toBe(true)
    }
  })

  it('handles empty columns', () => {
    expect(distributeColumnWidths([], 1000)).toEqual([])
  })
})
