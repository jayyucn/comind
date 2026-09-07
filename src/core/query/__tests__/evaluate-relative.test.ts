import { describe, it, expect } from 'vitest'
import { createRegistry, type Registry } from '@/core/query'
import { matchCondition } from '@/core/query/evaluate'
import type { ConditionValue } from '@/core/query'

interface Rec {
  id: string
  due: string | null
}

function makeRegistry(): Registry {
  const reg = createRegistry()
  reg.register('rec', { key: 'due', label: '截止日', type: 'date', get: (r: Rec) => r.due })
  return reg
}
const reg = makeRegistry()

/** 本地时区 YYYY-MM-DD。 */
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return iso(d)
}
const rel = (expr: string): ConditionValue => ({ kind: 'relativeDate', expr })
const lit = (value: string): ConditionValue => ({ kind: 'literal', value })

describe('relativeDate：求值时刻动态解析', () => {
  it("after 'yesterday' 匹配今天、不匹配前天（求值当下锚定）", () => {
    const today = daysAgo(0)
    const yesterday = daysAgo(1)
    const dayBefore = daysAgo(2)
    expect(matchCondition({ field: 'due', op: 'after', value: rel('yesterday') }, { id: 't', due: today }, reg, 'rec')).toBe(true)
    expect(matchCondition({ field: 'due', op: 'after', value: rel('yesterday') }, { id: 'y', due: yesterday }, reg, 'rec')).toBe(false)
    expect(matchCondition({ field: 'due', op: 'after', value: rel('yesterday') }, { id: 'b', due: dayBefore }, reg, 'rec')).toBe(false)
  })

  it("before 'today' 匹配昨天、不匹配今天/明天", () => {
    const today = daysAgo(0)
    const yesterday = daysAgo(1)
    expect(matchCondition({ field: 'due', op: 'before', value: rel('today') }, { id: 'y', due: yesterday }, reg, 'rec')).toBe(true)
    expect(matchCondition({ field: 'due', op: 'before', value: rel('today') }, { id: 't', due: today }, reg, 'rec')).toBe(false)
  })

  it('快捷 token（weekStart）与键入自由语法（+2）都可用', () => {
    const cond = { field: 'due', op: 'after' } as const
    expect(matchCondition({ ...cond, value: rel('weekStart') }, { id: 'a', due: iso(new Date()) }, reg, 'rec')).toBe(true)
    // +2：两天后 > 明天 → 今天 after +2 恒 false；四天后 after +2 恒 true
    const plus2 = daysAgo(-2)
    const plus4 = daysAgo(-4)
    expect(matchCondition({ ...cond, value: rel('+2') }, { id: 'p2', due: plus2 }, reg, 'rec')).toBe(false)
    expect(matchCondition({ ...cond, value: rel('+2') }, { id: 'p4', due: plus4 }, reg, 'rec')).toBe(true)
  })

  it('静态字面量（yyyy-MM-dd）与 relativeDate 语义并存、不受影响', () => {
    const fixed = daysAgo(3)
    expect(matchCondition({ field: 'due', op: 'is', value: lit(fixed) }, { id: 'f', due: fixed }, reg, 'rec')).toBe(true)
    expect(matchCondition({ field: 'due', op: 'is', value: lit(fixed) }, { id: 't', due: iso(new Date()) }, reg, 'rec')).toBe(false)
  })

  it('空值：relativeDate 解析失败或字段为空 → 非匹配（不参与过滤以外）', () => {
    expect(matchCondition({ field: 'due', op: 'after', value: rel('garbage') }, { id: 'x', due: iso(new Date()) }, reg, 'rec')).toBe(false)
    expect(matchCondition({ field: 'due', op: 'after', value: rel('today') }, { id: 'null', due: null }, reg, 'rec')).toBe(false)
  })
})
