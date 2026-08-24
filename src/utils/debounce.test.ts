import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { debounce } from './debounce'

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('delays function execution', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced()
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(99)
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('passes arguments to the debounced function', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced('arg1', 'arg2')
    vi.advanceTimersByTime(100)

    expect(fn).toHaveBeenCalledWith('arg1', 'arg2')
  })

  it('only executes once for multiple rapid calls', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced()
    debounced()
    debounced()
    vi.advanceTimersByTime(100)

    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('resets timer on each call', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced()
    vi.advanceTimersByTime(50)
    debounced()
    vi.advanceTimersByTime(50)
    debounced()
    vi.advanceTimersByTime(50)

    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(50)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('returns undefined', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    const result = debounced()
    vi.advanceTimersByTime(100)

    expect(result).toBeUndefined()
  })

  describe('cancel', () => {
    it('cancels pending execution', () => {
      const fn = vi.fn()
      const debounced = debounce(fn, 100)

      debounced()
      expect(fn).not.toHaveBeenCalled()

      debounced.cancel()

      vi.advanceTimersByTime(100)
      expect(fn).not.toHaveBeenCalled()
    })

    it('does nothing if no timer is pending', () => {
      const fn = vi.fn()
      const debounced = debounce(fn, 100)

      expect(() => debounced.cancel()).not.toThrow()
      vi.advanceTimersByTime(100)
      expect(fn).toHaveBeenCalledTimes(0)
    })

    it('can cancel and then call again', () => {
      const fn = vi.fn()
      const debounced = debounce(fn, 100)

      debounced()
      debounced.cancel()
      debounced()
      vi.advanceTimersByTime(100)

      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('has cancel as a function', () => {
      const fn = vi.fn()
      const debounced = debounce(fn, 100)

      expect(typeof debounced.cancel).toBe('function')
    })
  })

  describe('zero delay', () => {
    it('executes immediately with zero delay', () => {
      const fn = vi.fn()
      const debounced = debounce(fn, 0)

      debounced()
      vi.advanceTimersByTime(0)

      expect(fn).toHaveBeenCalledTimes(1)
    })
  })

  describe('edge cases', () => {
    it('handles concurrent debounced functions', () => {
      const fn1 = vi.fn()
      const fn2 = vi.fn()
      const debounced1 = debounce(fn1, 100)
      const debounced2 = debounce(fn2, 100)

      debounced1()
      debounced2()
      vi.advanceTimersByTime(100)

      expect(fn1).toHaveBeenCalledTimes(1)
      expect(fn2).toHaveBeenCalledTimes(1)
    })

    it('handles rapid cancel and restore', () => {
      const fn = vi.fn()
      const debounced = debounce(fn, 50)

      debounced()
      debounced.cancel()
      debounced()
      debounced.cancel()
      vi.advanceTimersByTime(50)

      expect(fn).not.toHaveBeenCalled()
    })
  })
})
