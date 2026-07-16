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
      { kind: 'deadline', iso: '2026-07-15T14:00', recurrence: 'weekly' },
    ])
  })

  it('parses schedule without recurrence (defaults to none)', () => {
    const text = '{{schedule:2026-07-20}}'
    expect(parseDateRefs(text)).toEqual([
      { kind: 'schedule', iso: '2026-07-20', recurrence: 'none' },
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
