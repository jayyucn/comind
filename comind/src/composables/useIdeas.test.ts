import { describe, test, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useJournal } from './useJournal'
import { format } from 'date-fns'

describe('useJournal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('today', () => {
    test('返回今天的日期字符串', () => {
      const { today } = useJournal()
      const expected = format(new Date(), 'yyyy-MM-dd')
      
      expect(today.value).toBe(expected)
    })
  })
})