import { describe, it, expect } from 'vitest'
import {
  serializeDateRef,
  formatIsoDisplay,
  normalizeRecurrence,
  padDateRefUnit,
} from './date-ref'

describe('padDateRefUnit — 插入时两侧补空格（防粘连）', () => {
  const u = '@2026-08-03 📅'

  it('文字-文字：两侧都补', () => {
    expect(padDateRefUnit('a', 'b', u)).toBe(' @2026-08-03 📅 ')
  })

  it('中文（非空白）：两侧都补', () => {
    expect(padDateRefUnit('买', '奶', u)).toBe(' @2026-08-03 📅 ')
  })

  it('左空白：只补右侧', () => {
    expect(padDateRefUnit(' ', 'b', u)).toBe('@2026-08-03 📅 ')
  })

  it('右空白：只补左侧', () => {
    expect(padDateRefUnit('a', ' ', u)).toBe(' @2026-08-03 📅')
  })

  it('两侧空白：不重复补（防双空格）', () => {
    expect(padDateRefUnit(' ', ' ', u)).toBe('@2026-08-03 📅')
  })

  it('行首（left null）：只补右侧', () => {
    expect(padDateRefUnit(null, 'b', u)).toBe('@2026-08-03 📅 ')
  })

  it('换行符左侧（行首段首）：补左空格，防单行渲染与上一行粘连', () => {
    expect(padDateRefUnit('\n', 'b', u)).toBe(' @2026-08-03 📅 ')
  })

  it('行尾（right null）：左侧补 + 行尾补尾空格', () => {
    expect(padDateRefUnit('a', null, u)).toBe(' @2026-08-03 📅 ')
  })

  it('独立块（两侧 null）：仅补尾空格', () => {
    expect(padDateRefUnit(null, null, u)).toBe('@2026-08-03 📅 ')
  })

  it('右邻为空字符串视同行尾', () => {
    expect(padDateRefUnit('a', '', u)).toBe(' @2026-08-03 📅 ')
  })

  it('nbsp 视为空白：不补', () => {
    expect(padDateRefUnit('\u00A0', 'b', u)).toBe('@2026-08-03 📅 ')
  })

  it('tab 视为空白：不补', () => {
    expect(padDateRefUnit('\t', 'b', u)).toBe('@2026-08-03 📅 ')
  })
})

describe('date-ref', () => {
  // parseDateRefs removed in 4.3 — all parsing moved to Rust DateRefService.
  // TS side accesses date refs via client.getDateRefsByBlock / getDateRefsByPage.
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
    const original = serializeDateRef({ kind: 'deadline', iso: '2026-07-15T14:00', recurrence: 'weekly', leadMinutes: 0 })
    expect(original).toBe('@2026-07-15T14:00 ⏰|weekly')
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
})
