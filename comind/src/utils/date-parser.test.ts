import { describe, it, expect } from 'vitest'
import { formatDate, parseDateInput } from './date-parser'

describe('formatDate', () => {
  it('formats date correctly', () => {
    const date = new Date(2026, 3, 26)
    expect(formatDate(date)).toBe('2026-04-26')
  })

  it('pads month and day with leading zeros', () => {
    const date = new Date(2026, 0, 5)
    expect(formatDate(date)).toBe('2026-01-05')
  })
})

describe('parseDateInput', () => {
  describe('相对日期', () => {
    it('parses "today"', () => {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      expect(parseDateInput('today')).toBe(formatDate(today))
    })

    it('parses "今天"', () => {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      expect(parseDateInput('今天')).toBe(formatDate(today))
    })

    it('parses "tomorrow"', () => {
      const tomorrow = new Date()
      tomorrow.setHours(0, 0, 0, 0)
      tomorrow.setDate(tomorrow.getDate() + 1)
      expect(parseDateInput('tomorrow')).toBe(formatDate(tomorrow))
    })

    it('parses "明天"', () => {
      const tomorrow = new Date()
      tomorrow.setHours(0, 0, 0, 0)
      tomorrow.setDate(tomorrow.getDate() + 1)
      expect(parseDateInput('明天')).toBe(formatDate(tomorrow))
    })

    it('parses "yesterday"', () => {
      const yesterday = new Date()
      yesterday.setHours(0, 0, 0, 0)
      yesterday.setDate(yesterday.getDate() - 1)
      expect(parseDateInput('yesterday')).toBe(formatDate(yesterday))
    })

    it('parses "昨天"', () => {
      const yesterday = new Date()
      yesterday.setHours(0, 0, 0, 0)
      yesterday.setDate(yesterday.getDate() - 1)
      expect(parseDateInput('昨天')).toBe(formatDate(yesterday))
    })

    it('parses "+N days" format', () => {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const expected = new Date(today)
      expected.setDate(expected.getDate() + 7)
      expect(parseDateInput('+7')).toBe(formatDate(expected))
    })

    it('parses "-N days" format', () => {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const expected = new Date(today)
      expected.setDate(expected.getDate() - 3)
      expect(parseDateInput('-3')).toBe(formatDate(expected))
    })

    it('parses "N days" format without sign', () => {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const expected = new Date(today)
      expected.setDate(expected.getDate() + 5)
      expect(parseDateInput('5')).toBe(formatDate(expected))
    })

    it('parses with "d" suffix', () => {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const expected = new Date(today)
      expected.setDate(expected.getDate() + 10)
      expect(parseDateInput('10d')).toBe(formatDate(expected))
    })

    it('parses with "day" suffix', () => {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const expected = new Date(today)
      expected.setDate(expected.getDate() + 2)
      expect(parseDateInput('2day')).toBe(formatDate(expected))
    })

    it('parses with "days" suffix', () => {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const expected = new Date(today)
      expected.setDate(expected.getDate() + 4)
      expect(parseDateInput('4days')).toBe(formatDate(expected))
    })
  })

  describe('部分日期', () => {
    it('parses MM-DD format', () => {
      const today = new Date()
      const expectedYear = (new Date(today.getFullYear(), 11, 25) < today) 
        ? today.getFullYear() + 1 
        : today.getFullYear()
      expect(parseDateInput('12-25')).toBe(`${expectedYear}-12-25`)
    })

    it('parses MM-DD with single digit month', () => {
      expect(parseDateInput('4-15')).toMatch(/^\d{4}-04-15$/)
    })

    it('parses MM-DD with single digit day', () => {
      expect(parseDateInput('04-5')).toMatch(/^\d{4}-04-05$/)
    })

    it('returns null for invalid MM-DD', () => {
      expect(parseDateInput('13-32')).toBeNull()
      expect(parseDateInput('0-0')).toBeNull()
    })

    it('parses YYYY-MM-DD format', () => {
      expect(parseDateInput('2026-04-26')).toBe('2026-04-26')
    })

    it('parses YYYY-MM-DD with single digit month and day', () => {
      expect(parseDateInput('2026-4-5')).toBe('2026-04-05')
    })

    it('returns null for invalid YYYY-MM-DD', () => {
      expect(parseDateInput('2026-13-45')).toBeNull()
      expect(parseDateInput('1999-02-30')).toBeNull()
    })

    it('returns null for years outside valid range', () => {
      expect(parseDateInput('1999-04-26')).toBeNull()
      expect(parseDateInput('2101-04-26')).toBeNull()
    })
  })

  describe('边界条件', () => {
    it('returns null for empty string', () => {
      expect(parseDateInput('')).toBeNull()
      expect(parseDateInput('   ')).toBeNull()
    })

    it('returns null for non-date strings', () => {
      expect(parseDateInput('Hello World')).toBeNull()
      expect(parseDateInput('Meeting Notes')).toBeNull()
      expect(parseDateInput('TODO')).toBeNull()
    })

    it('trims whitespace', () => {
      expect(parseDateInput('  2026-04-26  ')).toBe('2026-04-26')
      expect(parseDateInput('  today  ')).toBe(parseDateInput('today'))
    })

    it('handles case insensitivity', () => {
      expect(parseDateInput('TODAY')).toBe(parseDateInput('today'))
      expect(parseDateInput('Tomorrow')).toBe(parseDateInput('tomorrow'))
    })
  })
})