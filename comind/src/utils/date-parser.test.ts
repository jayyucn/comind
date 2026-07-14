import { describe, it, expect } from 'vitest'
import { parseDateTimeInput, combineDateTime, parseDateInput } from './date-parser'

describe('extractTime / parseDateTimeInput', () => {
  it('absolute date + numeric time', () => {
    expect(parseDateTimeInput('2026-07-15 14:00')).toEqual({ date: '2026-07-15', time: '14:00' })
  })

  it('absolute date + chinese time 下午2点', () => {
    expect(parseDateTimeInput('2026-07-15 下午2点')).toEqual({ date: '2026-07-15', time: '14:00' })
  })

  it('chinese time 早上9点半', () => {
    expect(parseDateTimeInput('2026-07-15 早上9点半')?.time).toBe('09:30')
  })

  it('chinese time 中午12点', () => {
    expect(parseDateTimeInput('2026-07-15 中午12点')?.time).toBe('12:00')
  })

  it('date only → no time', () => {
    expect(parseDateTimeInput('2026-07-15')).toEqual({ date: '2026-07-15' })
  })

  it('MM-DD parsed to current/future year', () => {
    const r = parseDateTimeInput('07-20')
    expect(r?.date).toMatch(/^\d{4}-07-20$/)
  })

  it('下周一 is a Monday in the future', () => {
    const r = parseDateTimeInput('下周一')
    expect(r).not.toBeNull()
    const d = new Date(`${r!.date}T00:00`)
    expect(d.getDay()).toBe(1) // Monday
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    expect(d.getTime()).toBeGreaterThan(today.getTime())
  })

  it('today returns today', () => {
    const r = parseDateTimeInput('今天')
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    expect(new Date(`${r!.date}T00:00`).getTime()).toBe(today.getTime())
  })

  it('combineDateTime with time', () => {
    expect(combineDateTime({ date: '2026-07-15', time: '14:00' })).toBe('2026-07-15T14:00')
  })

  it('combineDateTime all-day', () => {
    expect(combineDateTime({ date: '2026-07-15' })).toBe('2026-07-15')
  })
})

describe('parseDateInput backwards-compat', () => {
  it('returns YYYY-MM-DD for absolute date', () => {
    expect(parseDateInput('2026-07-15')).toBe('2026-07-15')
  })

  it('supports weekday after extension', () => {
    const r = parseDateInput('下周一')
    expect(r).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('empty input → null', () => {
    expect(parseDateInput('')).toBeNull()
  })
})
