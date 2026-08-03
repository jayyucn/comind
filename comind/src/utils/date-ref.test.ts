import { describe, it, expect } from 'vitest'
import {
  parseDateRefs,
  serializeDateRef,
  formatIsoDisplay,
  normalizeRecurrence,
} from './date-ref'

describe('parseDateRefs', () => {
  it('parses @2026-08-03 as kind=ref', () => {
    expect(parseDateRefs('@2026-08-03')).toEqual([
      { kind: 'ref', iso: '2026-08-03', recurrence: 'none', leadMinutes: 0 },
    ])
  })

  it('parses @2026-08-03T14:00 as kind=ref with time', () => {
    expect(parseDateRefs('@2026-08-03T14:00')).toEqual([
      { kind: 'ref', iso: '2026-08-03T14:00', recurrence: 'none', leadMinutes: 0 },
    ])
  })

  it('parses @2026-08-03 📅 as kind=schedule', () => {
    expect(parseDateRefs('@2026-08-03 📅')).toEqual([
      { kind: 'schedule', iso: '2026-08-03', recurrence: 'none', leadMinutes: 0 },
    ])
  })

  it('parses @2026-08-03 ⏰ as kind=deadline', () => {
    expect(parseDateRefs('@2026-08-03 ⏰')).toEqual([
      { kind: 'deadline', iso: '2026-08-03', recurrence: 'none', leadMinutes: 0 },
    ])
  })

  it('parses @2026-08-03 📅|weekly as schedule with recurrence', () => {
    expect(parseDateRefs('@2026-08-03 📅|weekly')).toEqual([
      { kind: 'schedule', iso: '2026-08-03', recurrence: 'weekly', leadMinutes: 0 },
    ])
  })

  it('parses @2026-08-03 ⏰||30 as deadline with leadMinutes', () => {
    expect(parseDateRefs('@2026-08-03 ⏰||30')).toEqual([
      { kind: 'deadline', iso: '2026-08-03', recurrence: 'none', leadMinutes: 30 },
    ])
  })

  it('extracts multiple dateRefs from one block', () => {
    const refs = parseDateRefs('@2026-07-20 📅 a @2026-07-17T18:00 ⏰|daily')
    expect(refs).toHaveLength(2)
    expect(refs[0].kind).toBe('schedule')
    expect(refs[1].kind).toBe('deadline')
  })

  it('does not match WikiLink / relationship / tag', () => {
    const text = '[[2026-07-15]] ((parent))[[x]] #tag'
    expect(parseDateRefs(text)).toEqual([])
  })

  it('invalid recurrence normalized to none', () => {
    expect(parseDateRefs('@2026-07-20 📅|foo')[0].recurrence).toBe('none')
  })

  it('empty text returns empty array', () => {
    expect(parseDateRefs('')).toEqual([])
  })

  it('does not match email-like @ in text', () => {
    expect(parseDateRefs('contact user@example.com')).toEqual([])
  })
})

describe('serializeDateRef', () => {
  it('ref kind serializes to @ format', () => {
    expect(serializeDateRef({ kind: 'ref', iso: '2026-08-03', recurrence: 'none', leadMinutes: 0 })).toBe(
      '@2026-08-03'
    )
  })

  it('schedule serializes to @ format with emoji', () => {
    expect(serializeDateRef({ kind: 'schedule', iso: '2026-08-03', recurrence: 'none', leadMinutes: 0 })).toBe(
      '@2026-08-03 📅'
    )
  })

  it('deadline serializes to @ format with emoji', () => {
    expect(serializeDateRef({ kind: 'deadline', iso: '2026-08-03', recurrence: 'none', leadMinutes: 0 })).toBe(
      '@2026-08-03 ⏰'
    )
  })

  it('schedule with recurrence serializes to @ format', () => {
    expect(serializeDateRef({ kind: 'schedule', iso: '2026-08-03', recurrence: 'weekly', leadMinutes: 0 })).toBe(
      '@2026-08-03 📅|weekly'
    )
  })

  it('deadline with leadMinutes serializes to @ format', () => {
    expect(serializeDateRef({ kind: 'deadline', iso: '2026-08-03', recurrence: 'none', leadMinutes: 30 })).toBe(
      '@2026-08-03 ⏰||30'
    )
  })

  it('schedule with recurrence + leadMinutes', () => {
    expect(serializeDateRef({ kind: 'schedule', iso: '2026-08-03', recurrence: 'weekly', leadMinutes: 15 })).toBe(
      '@2026-08-03 📅|weekly|15'
    )
  })

  it('round-trips through parse', () => {
    const original = '@2026-07-15T14:00 ⏰|weekly'
    const [parsed] = parseDateRefs(original)
    expect(serializeDateRef(parsed)).toBe(original)
  })
})

describe('formatIsoDisplay', () => {
  it('with time', () => {
    expect(formatIsoDisplay('2026-07-15T14:00')).toBe('07-15 14:00')
  })

  it('all-day', () => {
    expect(formatIsoDisplay('2026-07-15')).toBe('07-15')
  })

  it('shows year when not current year (past)', () => {
    expect(formatIsoDisplay('2025-12-25')).toBe('2025-12-25')
  })

  it('shows year when not current year (future)', () => {
    expect(formatIsoDisplay('2027-03-01T10:00')).toBe('2027-03-01 10:00')
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

describe('date-ref leadMinutes', () => {
  it('解析 @ISO 📅|weekly|15 含 leadMinutes', () => {
    const refs = parseDateRefs('text @2026-07-15T14:00 📅|weekly|15 end')
    expect(refs).toHaveLength(1)
    expect(refs[0].kind).toBe('schedule')
    expect(refs[0].iso).toBe('2026-07-15T14:00')
    expect(refs[0].recurrence).toBe('weekly')
    expect(refs[0].leadMinutes).toBe(15)
  })

  it('解析 @ISO ⏰||30 空 recurrence + leadMinutes', () => {
    const refs = parseDateRefs('@2026-07-15T14:00 ⏰||30')
    expect(refs).toHaveLength(1)
    expect(refs[0].recurrence).toBe('none')
    expect(refs[0].leadMinutes).toBe(30)
  })

  it('解析 @ISO ref 默认 lead=0', () => {
    const refs = parseDateRefs('@2026-07-15T14:00')
    expect(refs).toHaveLength(1)
    expect(refs[0].leadMinutes).toBe(0)
    expect(refs[0].recurrence).toBe('none')
  })

  it('序列化 lead=0 + recurrence=none → @ISO 📅', () => {
    expect(serializeDateRef({ kind: 'schedule', iso: '2026-07-15T14:00', recurrence: 'none', leadMinutes: 0 })).toBe('@2026-07-15T14:00 📅')
  })

  it('序列化 lead=0 + recurrence=weekly → @ISO 📅|weekly', () => {
    expect(serializeDateRef({ kind: 'schedule', iso: '2026-07-15T14:00', recurrence: 'weekly', leadMinutes: 0 })).toBe('@2026-07-15T14:00 📅|weekly')
  })

  it('序列化 lead=30 + recurrence=none → @ISO ⏰||30', () => {
    expect(serializeDateRef({ kind: 'deadline', iso: '2026-07-15', recurrence: 'none', leadMinutes: 30 })).toBe('@2026-07-15 ⏰||30')
  })

  it('序列化 lead=15 + recurrence=weekly → @ISO 📅|weekly|15', () => {
    expect(serializeDateRef({ kind: 'schedule', iso: '2026-07-15T14:00', recurrence: 'weekly', leadMinutes: 15 })).toBe('@2026-07-15T14:00 📅|weekly|15')
  })

  it('同 block 含 schedule + deadline 两个 date-ref 都正确解析', () => {
    const text = '@2026-07-15T09:00 📅|daily|5 任务 @2026-07-15T18:00 ⏰'
    const refs = parseDateRefs(text)
    expect(refs).toHaveLength(2)
    expect(refs[0].kind).toBe('schedule')
    expect(refs[0].leadMinutes).toBe(5)
    expect(refs[1].kind).toBe('deadline')
    expect(refs[1].leadMinutes).toBe(0)
  })
})
