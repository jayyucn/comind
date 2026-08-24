import { describe, it, expect } from 'vitest'

describe('BracketPairExtension utilities', () => {
  interface PairConfig {
    open: string
    close: string
  }

  const PAIRS: PairConfig[] = [
    { open: '[', close: ']' },
    { open: '(', close: ')' },
  ]

  describe('bracket pair matching', () => {
    function shouldAutoPair(char: string): boolean {
      return PAIRS.some(pair => pair.open === char)
    }

    function getClosePair(openChar: string): string | undefined {
      const pair = PAIRS.find(p => p.open === openChar)
      return pair?.close
    }

    function checkForPairDeletion(
      charBefore: string,
      charAfter: string
    ): boolean {
      return PAIRS.some(
        pair => pair.open === charBefore && pair.close === charAfter
      )
    }

    it('identifies auto-pairable characters', () => {
      expect(shouldAutoPair('[')).toBe(true)
      expect(shouldAutoPair('(')).toBe(true)
    })

    it('rejects non-pairable characters', () => {
      expect(shouldAutoPair('{')).toBe(false)
      expect(shouldAutoPair('<')).toBe(false)
      expect(shouldAutoPair('"')).toBe(false)
      expect(shouldAutoPair("'")).toBe(false)
    })

    it('gets correct close pair for open bracket', () => {
      expect(getClosePair('[')).toBe(']')
      expect(getClosePair('(')).toBe(')')
    })

    it('returns undefined for unknown open bracket', () => {
      expect(getClosePair('{')).toBeUndefined()
    })

    it('detects matching bracket pairs for deletion', () => {
      expect(checkForPairDeletion('[', ']')).toBe(true)
      expect(checkForPairDeletion('(', ')')).toBe(true)
    })

    it('rejects non-matching pairs for deletion', () => {
      expect(checkForPairDeletion('[', ')')).toBe(false)
      expect(checkForPairDeletion('(', ']')).toBe(false)
    })

    it('rejects single characters for deletion', () => {
      expect(checkForPairDeletion('[', '')).toBe(false)
      expect(checkForPairDeletion('', ']')).toBe(false)
    })
  })

  describe('position calculations for auto-pairing', () => {
    function calculateNewCursorPosition(
      from: number,
      _insertedOpen: string
    ): number {
      return from + 1
    }

    it('calculates cursor position after opening bracket', () => {
      expect(calculateNewCursorPosition(0, '[')).toBe(1)
      expect(calculateNewCursorPosition(5, '[')).toBe(6)
    })

    it('handles position at document start', () => {
      expect(calculateNewCursorPosition(0, '[')).toBe(1)
    })
  })

  describe('edge cases for bracket handling', () => {
    function getSurroundingChars(
      doc: string,
      pos: number
    ): { before: string; after: string } {
      const before = pos > 0 ? doc[pos - 1] : ''
      const after = pos < doc.length ? doc[pos] : ''
      return { before, after }
    }

    it('handles position at start of text', () => {
      const { before, after } = getSurroundingChars('hello', 0)
      expect(before).toBe('')
      expect(after).toBe('h')
    })

    it('handles position at end of text', () => {
      const { before, after } = getSurroundingChars('hello', 5)
      expect(before).toBe('o')
      expect(after).toBe('')
    })

    it('handles position in middle of text', () => {
      const { before, after } = getSurroundingChars('hello', 2)
      expect(before).toBe('e')
      expect(after).toBe('l')
    })

    it('handles empty text', () => {
      const { before, after } = getSurroundingChars('', 0)
      expect(before).toBe('')
      expect(after).toBe('')
    })

    it('handles single character text', () => {
      const { before, after } = getSurroundingChars('a', 0)
      expect(before).toBe('')
      expect(after).toBe('a')
    })

    it('handles single character text at end', () => {
      const { before, after } = getSurroundingChars('a', 1)
      expect(before).toBe('a')
      expect(after).toBe('')
    })
  })

  describe('pair configuration', () => {
    it('has square brackets configured', () => {
      const pair = PAIRS.find(p => p.open === '[')
      expect(pair).toBeDefined()
      expect(pair!.close).toBe(']')
    })

    it('has parentheses configured', () => {
      const pair = PAIRS.find(p => p.open === '(')
      expect(pair).toBeDefined()
      expect(pair!.close).toBe(')')
    })

    it('has exactly 2 configured pairs', () => {
      expect(PAIRS.length).toBe(2)
    })

    it('all pairs have non-empty open and close', () => {
      PAIRS.forEach(pair => {
        expect(pair.open.length).toBe(1)
        expect(pair.close.length).toBe(1)
        expect(pair.open).not.toBe(pair.close)
      })
    })
  })
})
