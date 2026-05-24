import { describe, it, expect } from 'vitest'

describe('WikiLinkExtension utilities', () => {
  describe('wiki link regex patterns', () => {
    const linkRegex = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g

    interface WikiLinkMatch {
      full: string
      page: string
      display: string | undefined
    }

    function parseWikiLinks(text: string): WikiLinkMatch[] {
      const matches: WikiLinkMatch[] = []
      let match
      while ((match = linkRegex.exec(text)) !== null) {
        matches.push({
          full: match[0],
          page: match[1],
          display: match[2]
        })
      }
      linkRegex.lastIndex = 0
      return matches
    }

    it('parses simple wiki link', () => {
      const matches = parseWikiLinks('[[PageName]]')
      expect(matches.length).toBe(1)
      expect(matches[0].page).toBe('PageName')
      expect(matches[0].display).toBeUndefined()
    })

    it('parses wiki link with display text', () => {
      const matches = parseWikiLinks('[[PageName|Display Text]]')
      expect(matches.length).toBe(1)
      expect(matches[0].page).toBe('PageName')
      expect(matches[0].display).toBe('Display Text')
    })

    it('parses multiple wiki links', () => {
      const matches = parseWikiLinks('[[Page1]] and [[Page2]]')
      expect(matches.length).toBe(2)
      expect(matches[0].page).toBe('Page1')
      expect(matches[1].page).toBe('Page2')
    })

    it('uses page name as display when not provided', () => {
      const matches = parseWikiLinks('[[My Page]]')
      expect(matches[0].page).toBe('My Page')
      expect(matches[0].display).toBeUndefined()
    })

    it('handles links with special characters in page name', () => {
      const matches = parseWikiLinks('[[Page-123_abc]]')
      expect(matches.length).toBe(1)
      expect(matches[0].page).toBe('Page-123_abc')
    })

    it('handles links with spaces in page name', () => {
      const matches = parseWikiLinks('[[My Important Page]]')
      expect(matches.length).toBe(1)
      expect(matches[0].page).toBe('My Important Page')
    })

    it('handles mixed simple and aliased links', () => {
      const matches = parseWikiLinks('[[Simple]] and [[Page|Alias]]')
      expect(matches.length).toBe(2)
      expect(matches[0].display).toBeUndefined()
      expect(matches[1].display).toBe('Alias')
    })

    it('returns empty array for no links', () => {
      const matches = parseWikiLinks('Just plain text')
      expect(matches.length).toBe(0)
    })

    it('returns empty array for empty string', () => {
      const matches = parseWikiLinks('')
      expect(matches.length).toBe(0)
    })

    it('returns empty array for empty display text (no match)', () => {
      const matches = parseWikiLinks('[[Page|]]')
      expect(matches.length).toBe(0)
    })

    it('handles Chinese characters in page name', () => {
      const matches = parseWikiLinks('[[页面名称]]')
      expect(matches.length).toBe(1)
      expect(matches[0].page).toBe('页面名称')
    })

    it('handles Chinese characters in display text', () => {
      const matches = parseWikiLinks('[[Page|显示文本]]')
      expect(matches.length).toBe(1)
      expect(matches[0].display).toBe('显示文本')
    })

    it('does not match single brackets', () => {
      const matches = parseWikiLinks('[single] [bracket]')
      expect(matches.length).toBe(0)
    })

    it('handles link at start of text', () => {
      const matches = parseWikiLinks('[[First]] rest')
      expect(matches.length).toBe(1)
      expect(matches[0].page).toBe('First')
    })

    it('handles link at end of text', () => {
      const matches = parseWikiLinks('start [[Last]]')
      expect(matches.length).toBe(1)
      expect(matches[0].page).toBe('Last')
    })

    it('handles consecutive links', () => {
      const matches = parseWikiLinks('[[A]][[B]][[C]]')
      expect(matches.length).toBe(3)
    })

    it('handles display text with special characters', () => {
      const matches = parseWikiLinks('[[Page|Hello, World!]]')
      expect(matches.length).toBe(1)
      expect(matches[0].display).toBe('Hello, World!')
    })

    it('handles display text with brackets inside', () => {
      const matches = parseWikiLinks('[[Page|Text (with) brackets]]')
      expect(matches.length).toBe(1)
      expect(matches[0].display).toBe('Text (with) brackets')
    })

    it('correctly handles pipe character in page names without alias', () => {
      const matches = parseWikiLinks('[[Page|With|Pipe]]')
      expect(matches.length).toBe(1)
      expect(matches[0].page).toBe('Page')
      expect(matches[0].display).toBe('With|Pipe')
    })

    it('matches nested wiki links greedily', () => {
      const matches = parseWikiLinks('[[Outer [[Inner]] Text]]')
      expect(matches.length).toBe(1)
      expect(matches[0].page).toBe('Outer [[Inner')
    })
  })

  describe('display text resolution', () => {
    const displayRegex = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g
    
    function getDisplayText(text: string): string | null {
      displayRegex.lastIndex = 0
      const match = displayRegex.exec(text)
      if (!match) return null
      return match[2] || match[1]
    }

    it('uses alias when present', () => {
      const result = getDisplayText('[[Page|Display]]')
      expect(result).toBe('Display')
    })

    it('uses page name when no alias', () => {
      const result = getDisplayText('[[PageName]]')
      expect(result).toBe('PageName')
    })

    it('returns null for no match', () => {
      const result = getDisplayText('no link here')
      expect(result).toBeNull()
    })
  })
})
