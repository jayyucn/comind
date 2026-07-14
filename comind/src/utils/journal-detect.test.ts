import { describe, it, expect } from 'vitest'
import {
  JOURNAL_FORMATS,
  JOURNAL_CANONICAL_FORMAT,
  parseToDate,
  isJournalTitle,
  normalizeJournalTitle,
  inferPageType
} from './ideas-detect'

describe('JOURNAL_FORMATS', () => {
  it('contains multiple date formats', () => {
    expect(JOURNAL_FORMATS.length).toBeGreaterThan(0)
  })

  it('includes the canonical format', () => {
    expect(JOURNAL_FORMATS).toContain('yyyy-MM-dd')
  })
})

describe('JOURNAL_CANONICAL_FORMAT', () => {
  it('is yyyy-MM-dd', () => {
    expect(JOURNAL_CANONICAL_FORMAT).toBe('yyyy-MM-dd')
  })
})

describe('parseToDate', () => {
  it('parses yyyy-MM-dd format', () => {
    const result = parseToDate('2026-04-26')
    expect(result).not.toBeNull()
    expect(result?.getFullYear()).toBe(2026)
    expect(result?.getMonth()).toBe(3)
    expect(result?.getDate()).toBe(26)
  })

  it('parses yyyy/MM/dd format', () => {
    const result = parseToDate('2026/04/26')
    expect(result).not.toBeNull()
  })

  it('parses yyyy_MM_dd format', () => {
    const result = parseToDate('2026_04_26')
    expect(result).not.toBeNull()
  })

  it('parses MMM do, yyyy format', () => {
    const result = parseToDate('Apr 26th, 2026')
    expect(result).not.toBeNull()
  })

  it('parses MM/dd/yyyy format', () => {
    const result = parseToDate('04/26/2026')
    expect(result).not.toBeNull()
  })

  it('parses dd.MM.yyyy format', () => {
    const result = parseToDate('26.04.2026')
    expect(result).not.toBeNull()
  })

  it('parses Chinese date format', () => {
    const result = parseToDate('2026年4月26日')
    expect(result).not.toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseToDate('')).toBeNull()
    expect(parseToDate('   ')).toBeNull()
  })

  it('returns null for invalid dates', () => {
    expect(parseToDate('not a date')).toBeNull()
    expect(parseToDate('2026-13-45')).toBeNull()
    expect(parseToDate('abc')).toBeNull()
  })

  it('returns null for non-date strings', () => {
    expect(parseToDate('Hello World')).toBeNull()
    expect(parseToDate('TODO')).toBeNull()
    expect(parseToDate('Meeting Notes')).toBeNull()
  })

  it('trims whitespace before parsing', () => {
    const result = parseToDate('  2026-04-26  ')
    expect(result).not.toBeNull()
  })
})

describe('isJournalTitle', () => {
  it('returns true for valid ideas dates', () => {
    expect(isJournalTitle('2026-04-26')).toBe(true)
    expect(isJournalTitle('2026/04/26')).toBe(true)
    expect(isJournalTitle('Apr 26th, 2026')).toBe(true)
  })

  it('returns false for non-date titles', () => {
    expect(isJournalTitle('Meeting Notes')).toBe(false)
    expect(isJournalTitle('Project Plan')).toBe(false)
    expect(isJournalTitle('TODO List')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isJournalTitle('')).toBe(false)
  })
})

describe('normalizeJournalTitle', () => {
  it('normalizes yyyy-MM-dd to canonical format', () => {
    const result = normalizeJournalTitle('2026-04-26')
    expect(result).toBe('2026-04-26')
  })

  it('normalizes other formats to canonical format', () => {
    expect(normalizeJournalTitle('2026/04/26')).toBe('2026-04-26')
    expect(normalizeJournalTitle('2026_04_26')).toBe('2026-04-26')
  })

  it('normalizes MMM do, yyyy format', () => {
    const result = normalizeJournalTitle('Apr 26th, 2026')
    expect(result).toBe('2026-04-26')
  })

  it('normalizes Chinese date format', () => {
    const result = normalizeJournalTitle('2026年4月26日')
    expect(result).toBe('2026-04-26')
  })

  it('returns null for non-date titles', () => {
    expect(normalizeJournalTitle('Meeting Notes')).toBeNull()
    expect(normalizeJournalTitle('Project Plan')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(normalizeJournalTitle('')).toBeNull()
  })
})

describe('inferPageType', () => {
  it('returns ideas for ideas titles', () => {
    expect(inferPageType('2026-04-26')).toBe('ideas')
    expect(inferPageType('Apr 26th, 2026')).toBe('ideas')
  })

  it('returns normal for non-ideas titles', () => {
    expect(inferPageType('Meeting Notes')).toBe('normal')
    expect(inferPageType('Project Plan')).toBe('normal')
  })

  it('returns normal for empty string', () => {
    expect(inferPageType('')).toBe('normal')
  })
})
