import { describe, it, expect } from 'vitest'
import {
  parseDateRefs,
  serializeDateRef,
  formatDateRefDisplay,
  formatIsoDisplay,
  normalizeRecurrence,
} from './date-ref'

describe('parseDateRefs', () => {
  it('parses deadline with recurrence', () => {
    const text = 'x {{deadline:2026-07-15T14:00|weekly}} y'
    expect(parseDateRefs(text)).toEqual([
      { kind: 'deadline', iso: '2026-07-15T14:00', recurrence: 'weekly', leadMinutes: 0 },
    ])
  })

  it('parses schedule without recurrence (defaults to none)', () => {
    const text = '{{schedule:2026-07-20}}'
    expect(parseDateRefs(text)).toEqual([
      { kind: 'schedule', iso: '2026-07-20', recurrence: 'none', leadMinutes: 0 },
    ])
  })

  it('extracts multiple dateRefs from one block', () => {
    const text = '{{schedule:2026-07-20}} a {{deadline:2026-07-17T18:00|daily}}'
    expect(parseDateRefs(text)).toHaveLength(2)
  })

  it('does not match WikiLink / relationship / tag', () => {
    const text = '[[2026-07-15]] ((parent))[[x]] #tag'
    expect(parseDateRefs(text)).toEqual([])
  })

  it('invalid recurrence normalized to none', () => {
    expect(parseDateRefs('{{schedule:2026-07-20|foo}}')[0].recurrence).toBe('none')
  })

  it('empty text returns empty array', () => {
    expect(parseDateRefs('')).toEqual([])
  })
})

describe('serializeDateRef', () => {
  it('with recurrence', () => {
    expect(serializeDateRef({ kind: 'deadline', iso: '2026-07-15T14:00', recurrence: 'weekly' })).toBe(
      '{{deadline:2026-07-15T14:00|weekly}}'
    )
  })

  it('none recurrence omitted', () => {
    expect(serializeDateRef({ kind: 'schedule', iso: '2026-07-20', recurrence: 'none' })).toBe(
      '{{schedule:2026-07-20}}'
    )
  })

  it('round-trips through parse', () => {
    const original = '{{deadline:2026-07-15T14:00|weekly}}'
    const [parsed] = parseDateRefs(original)
    expect(serializeDateRef(parsed)).toBe(original)
  })
})

describe('format', () => {
  it('formatIsoDisplay with time', () => {
    expect(formatIsoDisplay('2026-07-15T14:00')).toBe('07-15 14:00')
  })

  it('formatIsoDisplay all-day', () => {
    expect(formatIsoDisplay('2026-07-15')).toBe('07-15')
  })

  it('formatIsoDisplay shows year when not current year (past)', () => {
    expect(formatIsoDisplay('2025-12-25')).toBe('2025-12-25')
  })

  it('formatIsoDisplay shows year when not current year (future)', () => {
    expect(formatIsoDisplay('2027-03-01T10:00')).toBe('2027-03-01 10:00')
  })

  it('formatDateRefDisplay deadline', () => {
    expect(formatDateRefDisplay({ kind: 'deadline', iso: '2026-07-15T14:00', recurrence: 'weekly' })).toBe(
      '⏰ 07-15 14:00 · 每周'
    )
  })

  it('formatDateRefDisplay schedule all-day', () => {
    expect(formatDateRefDisplay({ kind: 'schedule', iso: '2026-07-20', recurrence: 'none' })).toBe(
      '📅 07-20'
    )
  })

  it('formatDateRefDisplay shows year for past deadline', () => {
    expect(formatDateRefDisplay({ kind: 'deadline', iso: '2025-12-25T09:00', recurrence: 'none' })).toBe(
      '⏰ 2025-12-25 09:00'
    )
  })
})

describe('normalizeRecurrence', () => {
  it('passes valid rules', () => {
    expect(normalizeRecurrence('monthly')).toBe('monthly')
  })
  it('invalid → none', () => {
    expect(normalizeRecurrence('foo')).toBe('none')
  })
  it('undefined → none', () => {
    expect(normalizeRecurrence(undefined)).toBe('none')
  })
})

describe('date-ref 语法扩展 (leadMinutes)', () => {
  it('解析 {{schedule:ISO|weekly|15}} 含 leadMinutes', () => {
    const refs = parseDateRefs('text {{schedule:2026-07-15T14:00|weekly|15}} end')
    expect(refs).toHaveLength(1)
    expect(refs[0].kind).toBe('schedule')
    expect(refs[0].iso).toBe('2026-07-15T14:00')
    expect(refs[0].recurrence).toBe('weekly')
    expect(refs[0].leadMinutes).toBe(15)
  })

  it('解析 {{schedule:ISO||30}} 空 recurrence + leadMinutes', () => {
    const refs = parseDateRefs('{{schedule:2026-07-15T14:00||30}}')
    expect(refs).toHaveLength(1)
    expect(refs[0].recurrence).toBe('none')
    expect(refs[0].leadMinutes).toBe(30)
  })

  it('解析 {{schedule:ISO}} 向后兼容 (默认 lead=0)', () => {
    const refs = parseDateRefs('{{schedule:2026-07-15T14:00}}')
    expect(refs).toHaveLength(1)
    expect(refs[0].leadMinutes).toBe(0)
    expect(refs[0].recurrence).toBe('none')
  })

  it('解析 {{schedule:ISO|weekly}} 向后兼容 (默认 lead=0)', () => {
    const refs = parseDateRefs('{{schedule:2026-07-15T14:00|weekly}}')
    expect(refs).toHaveLength(1)
    expect(refs[0].leadMinutes).toBe(0)
    expect(refs[0].recurrence).toBe('weekly')
  })

  it('序列化 lead=0 + recurrence=none → {{kind:iso}}', () => {
    expect(serializeDateRef({ kind: 'schedule', iso: '2026-07-15T14:00', recurrence: 'none', leadMinutes: 0 })).toBe('{{schedule:2026-07-15T14:00}}')
  })

  it('序列化 lead=0 + recurrence=weekly → {{kind:iso|weekly}}', () => {
    expect(serializeDateRef({ kind: 'schedule', iso: '2026-07-15T14:00', recurrence: 'weekly', leadMinutes: 0 })).toBe('{{schedule:2026-07-15T14:00|weekly}}')
  })

  it('序列化 lead=30 + recurrence=none → {{kind:iso||30}} (空第二段)', () => {
    expect(serializeDateRef({ kind: 'deadline', iso: '2026-07-15', recurrence: 'none', leadMinutes: 30 })).toBe('{{deadline:2026-07-15||30}}')
  })

  it('序列化 lead=15 + recurrence=weekly → {{kind:iso|weekly|15}}', () => {
    expect(serializeDateRef({ kind: 'schedule', iso: '2026-07-15T14:00', recurrence: 'weekly', leadMinutes: 15 })).toBe('{{schedule:2026-07-15T14:00|weekly|15}}')
  })

  it('同 block 含 schedule + deadline 两个 date-ref 都正确解析', () => {
    const text = '{{schedule:2026-07-15T09:00|daily|5}} 任务 {{deadline:2026-07-15T18:00}}'
    const refs = parseDateRefs(text)
    expect(refs).toHaveLength(2)
    expect(refs[0].kind).toBe('schedule')
    expect(refs[0].leadMinutes).toBe(5)
    expect(refs[1].kind).toBe('deadline')
    expect(refs[1].leadMinutes).toBe(0)
  })
})
