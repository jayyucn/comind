import { describe, it, expect } from 'vitest'
import { calculateNextRecurrence } from './recurrence'

describe('calculateNextRecurrence', () => {
  it('none returns same', () => {
    expect(calculateNextRecurrence('2026-07-15', 'none')).toBe('2026-07-15')
  })

  it('daily +1 day', () => {
    expect(calculateNextRecurrence('2026-07-15', 'daily')).toBe('2026-07-16')
  })

  it('weekly +7 days', () => {
    expect(calculateNextRecurrence('2026-07-15', 'weekly')).toBe('2026-07-22')
  })

  it('weekly preserves time', () => {
    expect(calculateNextRecurrence('2026-07-15T14:00', 'weekly')).toBe('2026-07-22T14:00')
  })

  it('monthly clamps end-of-month (Jan 31 → Feb 28)', () => {
    expect(calculateNextRecurrence('2026-01-31', 'monthly')).toBe('2026-02-28')
  })

  it('monthly normal (Jul 15 → Aug 15)', () => {
    expect(calculateNextRecurrence('2026-07-15', 'monthly')).toBe('2026-08-15')
  })

  it('yearly leap-day safe (2024-02-29 → 2025-02-28)', () => {
    expect(calculateNextRecurrence('2024-02-29', 'yearly')).toBe('2025-02-28')
  })

  it('yearly normal', () => {
    expect(calculateNextRecurrence('2026-07-15', 'yearly')).toBe('2027-07-15')
  })

  it('invalid iso returns unchanged', () => {
    expect(calculateNextRecurrence('not-a-date', 'weekly')).toBe('not-a-date')
  })
})
