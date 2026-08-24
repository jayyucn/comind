import { describe, it, expect } from 'vitest'
import { distributeColumnWidths } from './tableWidths'

describe('distributeColumnWidths (比例模式，ADR-0013)', () => {
  it('splits evenly when all baselines are equal', () => {
    // [160,160,160] @1000：minTotal=120, free=880, 权重相等 → 40+880/3≈333.33；末列吸收误差
    const out = distributeColumnWidths([160, 160, 160], 1000)
    expect(out[0]).toBeCloseTo(333.33, 1)
    expect(out[2]).toBeCloseTo(333.34, 1)
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1000, 0)
  })

  it('allocates leftover space by (baseline - min) weight', () => {
    // [300,100] @1000：weights=[260,60] → col0=40+920×260/320=787.5；末列=1000-787.5
    const out = distributeColumnWidths([300, 100], 1000)
    expect(out[0]).toBeCloseTo(787.5, 1)
    expect(out[1]).toBeCloseTo(212.5, 1)
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1000, 0)
  })

  it('scales equal-baseline columns strictly proportionally as the container grows', () => {
    const a = distributeColumnWidths([160, 160, 160], 500)
    const b = distributeColumnWidths([160, 160, 160], 1000)
    expect(b[0] / a[0]).toBeCloseTo(2, 1)
  })

  it('keeps the weighted share ratio constant as the container changes', () => {
    // 权重部分 (w - min) / free 恒定：容器 500→1000 时 free 420→920
    const a = distributeColumnWidths([300, 100], 500)
    const b = distributeColumnWidths([300, 100], 1000)
    expect((b[0] - 40) / 920).toBeCloseTo((a[0] - 40) / 420, 3)
    expect((b[1] - 40) / 920).toBeCloseTo((a[1] - 40) / 420, 3)
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

  it('handles empty columns', () => {
    expect(distributeColumnWidths([], 1000)).toEqual([])
  })
})
