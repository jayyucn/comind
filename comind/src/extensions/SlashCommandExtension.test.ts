import { describe, it, expect } from 'vitest'

describe('SlashCommandExtension utilities', () => {
  describe('isInURL detection logic', () => {
    function isInURL(doc: any, pos: number): boolean {
      const $pos = doc.resolve(pos)
      const textBefore = $pos.nodeBefore?.text || ''

      if (textBefore.match(/https?:\/\/[^\s]*$/)) return true
      if (textBefore.match(/ftp:\/\/[^\s]*$/)) return true

      if (textBefore.match(/[\w.-]+@[\w.-]+$/)) return true

      return false
    }

    function createMockDoc(textBefore: string) {
      return {
        resolve: (_pos: number) => ({
          nodeBefore: textBefore ? { text: textBefore } : null
        })
      }
    }

    it('detects HTTP URLs', () => {
      const doc = createMockDoc('https://example.com')
      expect(isInURL(doc, 19)).toBe(true)
    })

    it('detects HTTPS URLs', () => {
      const doc = createMockDoc('https://secure.example.com/path')
      expect(isInURL(doc, 28)).toBe(true)
    })

    it('detects FTP URLs', () => {
      const doc = createMockDoc('ftp://files.example.com')
      expect(isInURL(doc, 23)).toBe(true)
    })

    it('detects email addresses', () => {
      const doc = createMockDoc('user@example.com')
      expect(isInURL(doc, 16)).toBe(true)
    })

    it('detects email with subdomain', () => {
      const doc = createMockDoc('user@mail.example.com')
      expect(isInURL(doc, 21)).toBe(true)
    })

    it('returns false for regular text', () => {
      const doc = createMockDoc('Hello world')
      expect(isInURL(doc, 11)).toBe(false)
    })

    it('returns false for empty text before cursor', () => {
      const doc = createMockDoc('')
      expect(isInURL(doc, 0)).toBe(false)
    })

    it('returns false for null nodeBefore', () => {
      const doc = { resolve: () => ({ nodeBefore: null }) }
      expect(isInURL(doc, 0)).toBe(false)
    })

    it('returns false when URL is followed by space', () => {
      const doc = createMockDoc('https://example.com ')
      expect(isInURL(doc, 20)).toBe(false)
    })

    it('returns false for incomplete URL protocol', () => {
      const doc = createMockDoc('htt')
      expect(isInURL(doc, 3)).toBe(false)
    })

    it('handles URL with query parameters', () => {
      const doc = createMockDoc('https://example.com?q=1&a=2')
      expect(isInURL(doc, 27)).toBe(true)
    })

    it('handles URL with fragment', () => {
      const doc = createMockDoc('https://example.com/#section')
      expect(isInURL(doc, 28)).toBe(true)
    })

    it('detects email-like patterns (including those without TLD)', () => {
      const doc = createMockDoc('user@domain')
      expect(isInURL(doc, 10)).toBe(true)
    })
  })

  describe('slash command trigger conditions', () => {
    function shouldTriggerSlashCommand(textBefore: string | null): boolean {
      if (!textBefore || textBefore.length === 0) return true
      return textBefore.match(/[\s\n]$/) !== null
    }

    it('triggers at document start', () => {
      expect(shouldTriggerSlashCommand(null)).toBe(true)
    })

    it('triggers after newline', () => {
      expect(shouldTriggerSlashCommand('\n')).toBe(true)
    })

    it('triggers after space', () => {
      expect(shouldTriggerSlashCommand(' ')).toBe(true)
    })

    it('triggers after multiple spaces', () => {
      expect(shouldTriggerSlashCommand('   ')).toBe(true)
    })

    it('does not trigger in middle of word', () => {
      expect(shouldTriggerSlashCommand('hello')).toBe(false)
    })

    it('does not trigger after text without space', () => {
      expect(shouldTriggerSlashCommand('word')).toBe(false)
    })

    it('triggers after text with trailing newline', () => {
      expect(shouldTriggerSlashCommand('text\n')).toBe(true)
    })
  })
})
