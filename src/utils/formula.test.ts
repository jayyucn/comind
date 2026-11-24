import { describe, expect, it } from 'vitest'
import {
  collectReferences,
  detectCycle,
  evaluateFormula,
  safeEvaluateFormula,
  validateFormula,
} from './formula'

describe('evaluateFormula（issue T11 求值器）', () => {
  it('纯算术与优先级', () => {
    expect(evaluateFormula('1 + 2 * 3', {})).toEqual({ ok: true, value: 7 })
    expect(evaluateFormula('(1 + 2) * 3', {})).toEqual({ ok: true, value: 9 })
    expect(evaluateFormula('10 / 4', {})).toEqual({ ok: true, value: 2.5 })
    expect(evaluateFormula('10 % 3', {})).toEqual({ ok: true, value: 1 })
  })

  it('一元负号', () => {
    expect(evaluateFormula('-5 + 3', {})).toEqual({ ok: true, value: -2 })
    expect(evaluateFormula('3 - -2', {})).toEqual({ ok: true, value: 5 })
    expect(evaluateFormula('-(2 + 3)', {})).toEqual({ ok: true, value: -5 })
  })

  it('引用同块字段（标识符）', () => {
    expect(evaluateFormula('price * qty', { price: 10, qty: 3 })).toEqual({ ok: true, value: 30 })
    expect(evaluateFormula('a + b + c', { a: 1, b: 2, c: 3 })).toEqual({ ok: true, value: 6 })
  })

  it('缺失/未知引用按 0 处理（宽容，不炸）', () => {
    expect(evaluateFormula('price * qty', { price: 10 })).toEqual({ ok: true, value: 0 })
    expect(evaluateFormula('missing + 5', {})).toEqual({ ok: true, value: 5 })
  })

  it('内建函数', () => {
    expect(evaluateFormula('abs(-4)', {})).toEqual({ ok: true, value: 4 })
    expect(evaluateFormula('max(1, 9, 4)', {})).toEqual({ ok: true, value: 9 })
    expect(evaluateFormula('min(a, b)', { a: 7, b: 2 })).toEqual({ ok: true, value: 2 })
    expect(evaluateFormula('round(2.6)', {})).toEqual({ ok: true, value: 3 })
    expect(evaluateFormula('pow(2, 10)', {})).toEqual({ ok: true, value: 1024 })
    expect(evaluateFormula('sqrt(max(9, 4))', {})).toEqual({ ok: true, value: 3 })
  })

  it('解析/求值错误返回 error 文案', () => {
    expect(evaluateFormula('1 +', {}).ok).toBe(false)
    expect(evaluateFormula('(1 + 2', {}).ok).toBe(false)
    expect(evaluateFormula('1 / 0', {}).ok).toBe(false)
    expect(evaluateFormula('1 % 0', {}).ok).toBe(false)
    expect(evaluateFormula('foo(', {}).ok).toBe(false)
    expect(evaluateFormula('1 +* 2', {}).ok).toBe(false)
  })

  it('validateFormula 仅校验语法', () => {
    expect(validateFormula('a * (b + c)')).toEqual({ ok: true })
    expect(validateFormula('1 +')).toEqual({ ok: false, error: expect.any(String) })
  })

  it('safeEvaluateFormula 失败时回 null', () => {
    expect(safeEvaluateFormula('1 / 0', {})).toBeNull()
    expect(safeEvaluateFormula('price * 2', { price: 4 })).toBe(8)
  })
})

describe('collectReferences（issue T11 依赖收集）', () => {
  it('提取标识符、排除函数名与数字', () => {
    expect(collectReferences('max(a, b) + c * 2').sort()).toEqual(['a', 'b', 'c'])
    expect(collectReferences('abs(x - y)').sort()).toEqual(['x', 'y'])
  })
})

describe('detectCycle（issue T11 循环依赖检测）', () => {
  it('无环返回 null', () => {
    expect(
      detectCycle([
        { key: 'total', formula: 'price * qty' },
        { key: 'price', formula: 'base' },
      ]),
    ).toBeNull()
  })

  it('检测 A→B→A 环', () => {
    const cyc = detectCycle([
      { key: 'a', formula: 'b + 1' },
      { key: 'b', formula: 'a + 1' },
    ])
    expect(cyc).not.toBeNull()
    expect(cyc![0]).toBe(cyc![cyc!.length - 1]) // 闭环
    expect(new Set(cyc)).toEqual(new Set(['a', 'b']))
  })

  it('检测自引用 A→A', () => {
    const cyc = detectCycle([{ key: 'a', formula: 'a + 1' }])
    expect(cyc).toEqual(['a', 'a'])
  })

  it('引用非公式字段不构成环', () => {
    // b 不是公式字段，a 引用 b 是叶子，无环
    expect(detectCycle([{ key: 'a', formula: 'b + 1' }])).toBeNull()
  })
})
