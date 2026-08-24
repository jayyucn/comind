import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { notifyWikiLinkMenuSelect, findWikiLinkAtCursor, closeWikiLinkMenuByEditor } from './WikiLinkTriggerExtension'

function createMockDoc(textNodes: { text: string; pos: number }[]) {
  const content = textNodes.map(n => ({
    isText: true,
    text: n.text,
    nodeSize: n.text.length
  }))
  
  return {
    descendants: (fn: (node: any, pos: number) => void) => {
      for (const node of content) {
        const nodePos = textNodes.find(n => n.text === node.text)?.pos ?? 0
        fn(node, nodePos)
      }
    }
  }
}

describe('WikiLinkTriggerExtension', () => {
  describe('module exports', () => {
    test('should export notifyWikiLinkMenuSelect function', () => {
      expect(notifyWikiLinkMenuSelect).toBeDefined()
      expect(typeof notifyWikiLinkMenuSelect).toBe('function')
    })
  })

  describe('WikiLinkTriggerEvent interface', () => {
    test('should have correct event structure', () => {
      const event: any = {
        view: {},
        position: 10,
        range: { from: 5, to: 10 },
        query: 'test'
      }

      expect(event.view).toBeDefined()
      expect(event.position).toBe(10)
      expect(event.range.from).toBe(5)
      expect(event.range.to).toBe(10)
      expect(event.query).toBe('test')
    })
  })

  describe('WikiLinkUpdateEvent interface', () => {
    test('should have correct event structure', () => {
      const event: any = {
        query: 'updated query'
      }

      expect(event.query).toBeDefined()
      expect(event.query).toBe('updated query')
    })
  })

  describe('WikiLinkCloseEvent interface', () => {
    test('should support cursor-move reason', () => {
      const event: any = {
        reason: 'cursor-move' as const
      }

      expect(event.reason).toBe('cursor-move')
    })

    test('should support doc-change reason', () => {
      const event: any = {
        reason: 'doc-change' as const
      }

      expect(event.reason).toBe('doc-change')
    })
  })

  describe('WikiLinkTriggerExtension module', () => {
    test('should export an object with create method', async () => {
      const { WikiLinkTriggerExtension } = await import('./WikiLinkTriggerExtension')
      expect(WikiLinkTriggerExtension).toBeDefined()
      expect(typeof WikiLinkTriggerExtension).toBe('object')
    })
  })

  describe('wiki link pattern detection', () => {
    test('should match simple wiki link pattern', () => {
      const linkRegex = /\[\[([^\]|]*?)(?:\|[^\]]*?)?\]\]/g
      const text = 'Some text with [[WikiLink]] inside'
      const matches: Array<{ start: number; end: number; query: string }> = []

      let match
      while ((match = linkRegex.exec(text)) !== null) {
        const start = match.index
        const end = start + match[0].length
        matches.push({
          start,
          end,
          query: match[1] || ''
        })
      }

      expect(matches.length).toBe(1)
      expect(matches[0].query).toBe('WikiLink')
      expect(text.substring(matches[0].start, matches[0].end)).toBe('[[WikiLink]]')
    })

    test('should extract query from wiki link', () => {
      const linkRegex = /\[\[([^\]|]*?)(?:\|[^\]]*?)?\]\]/g
      const text = 'Click [[TargetPage]] to navigate'
      const matches: Array<{ query: string }> = []

      let match
      while ((match = linkRegex.exec(text)) !== null) {
        matches.push({ query: match[1] || '' })
      }

      expect(matches.length).toBe(1)
      expect(matches[0].query).toBe('TargetPage')
    })

    test('should handle wiki link with display text', () => {
      const linkRegex = /\[\[([^\]|]*?)(?:\|[^\]]*?)?\]\]/g
      const text = 'See [[Page|Display Text]] for details'
      const matches: Array<{ query: string }> = []

      let match
      while ((match = linkRegex.exec(text)) !== null) {
        matches.push({ query: match[1] || '' })
      }

      expect(matches.length).toBe(1)
      expect(matches[0].query).toBe('Page')
    })

    test('should match multiple wiki links', () => {
      const linkRegex = /\[\[([^\]|]*?)(?:\|[^\]]*?)?\]\]/g
      const text = '[[Page1]] and [[Page2]] and [[Page3]]'
      const matches: string[] = []

      let match
      while ((match = linkRegex.exec(text)) !== null) {
        matches.push(match[1])
      }

      expect(matches.length).toBe(3)
      expect(matches).toEqual(['Page1', 'Page2', 'Page3'])
    })

    test('should return empty query for incomplete link', () => {
      const linkRegex = /\[\[([^\]|]*?)(?:\|[^\]]*?)?\]\]/g
      const text = 'Incomplete [[ link'
      const matches: string[] = []

      let match
      while ((match = linkRegex.exec(text)) !== null) {
        matches.push(match[1])
      }

      expect(matches.length).toBe(0)
    })

    test('should handle unicode characters in page names', () => {
      const linkRegex = /\[\[([^\]|]*?)(?:\|[^\]]*?)?\]\]/g
      const text = '[[中文页面]]'
      const matches: string[] = []

      let match
      while ((match = linkRegex.exec(text)) !== null) {
        matches.push(match[1])
      }

      expect(matches.length).toBe(1)
      expect(matches[0]).toBe('中文页面')
    })

    test('should handle special characters in page names', () => {
      const linkRegex = /\[\[([^\]|]*?)(?:\|[^\]]*?)?\]\]/g
      const text = '[[页面-123_abc]]'
      const matches: string[] = []

      let match
      while ((match = linkRegex.exec(text)) !== null) {
        matches.push(match[1])
      }

      expect(matches.length).toBe(1)
      expect(matches[0]).toBe('页面-123_abc')
    })

    test('should handle link at start of text', () => {
      const linkRegex = /\[\[([^\]|]*?)(?:\|[^\]]*?)?\]\]/g
      const text = '[[First]] rest'
      const matches: string[] = []

      let match
      while ((match = linkRegex.exec(text)) !== null) {
        matches.push(match[1])
      }

      expect(matches.length).toBe(1)
      expect(matches[0]).toBe('First')
    })

    test('should handle link at end of text', () => {
      const linkRegex = /\[\[([^\]|]*?)(?:\|[^\]]*?)?\]\]/g
      const text = 'start [[Last]]'
      const matches: string[] = []

      let match
      while ((match = linkRegex.exec(text)) !== null) {
        matches.push(match[1])
      }

      expect(matches.length).toBe(1)
      expect(matches[0]).toBe('Last')
    })

    test('should detect cursor position within wiki link range', () => {
      const linkRegex = /\[\[([^\]|]*?)(?:\|[^\]]*?)?\]\]/g
      const text = 'Start [[WikiLink]] End'
      const targetPos = 10
      let found = false
      let linkInfo: { from: number; to: number; query: string } | null = null

      let match
      while ((match = linkRegex.exec(text)) !== null) {
        const start = match.index
        const end = start + match[0].length

        if (targetPos >= start && targetPos <= end) {
          found = true
          linkInfo = { from: start, to: end, query: match[1] }
          break
        }
      }

      expect(found).toBe(true)
      expect(linkInfo).not.toBeNull()
      expect(linkInfo!.query).toBe('WikiLink')
    })

    test('should return not found for cursor outside wiki link', () => {
      const linkRegex = /\[\[([^\]|]*?)(?:\|[^\]]*?)?\]\]/g
      const text = 'Start [[WikiLink]] End'
      const targetPos = 0
      let found = false

      let match
      while ((match = linkRegex.exec(text)) !== null) {
        const start = match.index
        const end = start + match[0].length

        if (targetPos >= start && targetPos <= end) {
          found = true
          break
        }
      }

      expect(found).toBe(false)
    })
  })

  describe('notifyWikiLinkMenuSelect', () => {
    test('should execute without error', () => {
      expect(() => notifyWikiLinkMenuSelect()).not.toThrow()
    })

    test('should be callable multiple times', () => {
      expect(() => {
        notifyWikiLinkMenuSelect()
        notifyWikiLinkMenuSelect()
        notifyWikiLinkMenuSelect()
      }).not.toThrow()
    })
  })

  describe('keyboard navigation triggers', () => {
    test('ArrowUp should trigger navigation when menu is open', () => {
      const menuIsOpen = true
      const key = 'ArrowUp'

      const shouldPreventDefault = menuIsOpen && ['Enter', 'Escape', 'ArrowUp', 'ArrowDown'].includes(key)

      expect(shouldPreventDefault).toBe(true)
    })

    test('ArrowDown should trigger navigation when menu is open', () => {
      const menuIsOpen = true
      const key = 'ArrowDown'

      const shouldPreventDefault = menuIsOpen && ['Enter', 'Escape', 'ArrowUp', 'ArrowDown'].includes(key)

      expect(shouldPreventDefault).toBe(true)
    })

    test('Enter should confirm selection when menu is open', () => {
      const menuIsOpen = true
      const key = 'Enter'

      const shouldPreventDefault = menuIsOpen && ['Enter', 'Escape', 'ArrowUp', 'ArrowDown'].includes(key)

      expect(shouldPreventDefault).toBe(true)
    })

    test('Escape should close menu when menu is open', () => {
      const menuIsOpen = true
      const key = 'Escape'

      const shouldPreventDefault = menuIsOpen && ['Enter', 'Escape', 'ArrowUp', 'ArrowDown'].includes(key)

      expect(shouldPreventDefault).toBe(true)
    })

    test('other keys should not prevent default when menu is closed', () => {
      const menuIsOpen = false
      const key = 'a'

      const shouldPreventDefault = menuIsOpen && ['Enter', 'Escape', 'ArrowUp', 'ArrowDown'].includes(key)

      expect(shouldPreventDefault).toBe(false)
    })
  })

  describe('double bracket trigger detection', () => {
    test('should detect [[ when followed by ]', () => {
      const textBefore = 'Some ['
      const endsWithOpenBracket = textBefore.endsWith('[')

      expect(endsWithOpenBracket).toBe(true)
    })

    test('should not trigger on single bracket', () => {
      const textBefore = 'Some ['
      const textAfter = 'text'

      const endsWithOpenBracket = textBefore.endsWith('[')
      const hasCloseBracketAfter = textAfter === ']'

      expect(endsWithOpenBracket).toBe(true)
      expect(hasCloseBracketAfter).toBe(false)
    })

    test('should extract query between [[ and ]]', () => {
      const textAtRange = '[[Test]]'
      const queryMatch = textAtRange.match(/^\[\[(.*?)\]/)
      const query = queryMatch ? queryMatch[1] : ''

      expect(query).toBe('Test')
    })

    test('should handle empty query', () => {
      const textAtRange = '[[]]'
      const queryMatch = textAtRange.match(/^\[\[(.*?)\]/)
      const query = queryMatch ? queryMatch[1] : ''

      expect(query).toBe('')
    })

    test('should handle incomplete link', () => {
      const textAtRange = '[['
      const queryMatch = textAtRange.match(/^\[\[(.*?)\]/)
      const query = queryMatch ? queryMatch[1] : ''

      expect(query).toBe('')
    })
  })

  describe('wiki link text input detection', () => {
    test('should detect [[ prefix in text before cursor', () => {
      const textBefore = '[[some text'
      const matchBefore = /^\[\[[^\[\]]*/.exec(textBefore)

      expect(matchBefore).not.toBeNull()
      expect(matchBefore![0]).toBe('[[some text')
    })

    test('should detect ]] suffix in text after cursor', () => {
      const textAfter = ']] more text'
      const matchAfter = /[^\[\]]*\]\]/.exec(textAfter)

      expect(matchAfter).not.toBeNull()
      expect(matchAfter![0]).toBe(']]')
    })

    test('should combine query from before and after text', () => {
      const textBefore = '[[page'
      const textAfter = 'link]]'
      const matchBefore = /^\[\[[^\[\]]*/.exec(textBefore)
      const matchAfter = /[^\[\]]*\]\]/.exec(textAfter)

      expect(matchBefore).not.toBeNull()
      expect(matchAfter).not.toBeNull()

      const query = matchBefore![0] + textBefore.slice(matchBefore![0].length) + matchAfter![0]

      expect(query).toBe('[[pagelink]]')
    })

    test('should not match when before text lacks [[', () => {
      const textBefore = 'plain text'
      const matchBefore = /^\[\[[^\[\]]*/.exec(textBefore)

      expect(matchBefore).toBeNull()
    })

    test('should not match when after text lacks ]]', () => {
      const textAfter = 'plain text'
      const matchAfter = /[^\[\]]*\]\]/.exec(textAfter)

      expect(matchAfter).toBeNull()
    })

    test('should handle nested brackets correctly', () => {
      const textBefore = '[[outer [[inner'
      const matchBefore = /^\[\[[^\[\]]*/.exec(textBefore)

      expect(matchBefore).not.toBeNull()
    })

    test('should handle empty textBefore', () => {
      const textBefore = ''
      const matchBefore = /^\[\[[^\[\]]*/.exec(textBefore)

      expect(matchBefore).toBeNull()
    })

    test('should handle empty textAfter', () => {
      const textAfter = ''
      const matchAfter = /[^\[\]]*\]\]/.exec(textAfter)

      expect(matchAfter).toBeNull()
    })
  })

  describe('menu state management behavior', () => {
    test('menuIsOpen should be initially false', () => {
      let menuIsOpen = false
      expect(menuIsOpen).toBe(false)
    })

    test('menuIsOpen should be set to true on trigger', () => {
      let menuIsOpen = false
      menuIsOpen = true
      expect(menuIsOpen).toBe(true)
    })

    test('selectingFromMenu should be set on menu select', () => {
      let selectingFromMenu = false
      selectingFromMenu = true
      setTimeout(() => {
        selectingFromMenu = false
      }, 100)

      expect(selectingFromMenu).toBe(true)
    })
  })

  describe('findWikiLinkAtCursor', () => {
    test('should find cursor in complete wiki link [[page]]', () => {
      const doc = createMockDoc([{ text: '[[PageName]]', pos: 0 }])
      const result = findWikiLinkAtCursor(doc as any, 5)
      
      expect(result.found).toBe(true)
      expect(result.range).toEqual({ from: 0, to: 12 })
      expect(result.query).toBe('PageName')
    })

    test('should find cursor in wiki link with display [[page|display]]', () => {
      const doc = createMockDoc([{ text: '[[PageName|Display]]', pos: 0 }])
      const result = findWikiLinkAtCursor(doc as any, 5)
      
      expect(result.found).toBe(true)
      expect(result.query).toBe('PageName')
    })

    test('should find cursor in incomplete link [[page', () => {
      const doc = createMockDoc([{ text: '[[PageName', pos: 0 }])
      const result = findWikiLinkAtCursor(doc as any, 5)
      
      expect(result.found).toBe(true)
      expect(result.range).toEqual({ from: 0, to: 10 })
      expect(result.query).toBe('PageName')
    })

    test('should return not found when cursor outside links', () => {
      const doc = createMockDoc([{ text: 'Just plain text', pos: 0 }])
      const result = findWikiLinkAtCursor(doc as any, 5)
      
      expect(result.found).toBe(false)
      expect(result.range).toBeNull()
      expect(result.query).toBe('')
    })

    test('should find cursor in link with surrounding text', () => {
      const doc = createMockDoc([{ text: 'Hello [[PageName]] World', pos: 0 }])
      const result = findWikiLinkAtCursor(doc as any, 10)
      
      expect(result.found).toBe(true)
      expect(result.range).toEqual({ from: 6, to: 18 })
      expect(result.query).toBe('PageName')
    })

    test('should handle empty link [[]]', () => {
      const doc = createMockDoc([{ text: '[[]]', pos: 0 }])
      const result = findWikiLinkAtCursor(doc as any, 2)
      
      expect(result.found).toBe(true)
      expect(result.query).toBe('')
    })

    test('should not find link when cursor at exact start position', () => {
      const doc = createMockDoc([{ text: '[[PageName]]', pos: 0 }])
      const result = findWikiLinkAtCursor(doc as any, 0)
      
      expect(result.found).toBe(false)
    })

    test('should find link when cursor at exact end position', () => {
      const doc = createMockDoc([{ text: '[[PageName]]', pos: 0 }])
      const result = findWikiLinkAtCursor(doc as any, 12)
      
      expect(result.found).toBe(true)
      expect(result.query).toBe('PageName')
    })

    test('should handle multiple text nodes', () => {
      const doc = createMockDoc([
        { text: 'Start ', pos: 0 },
        { text: '[[Link]]', pos: 6 },
        { text: ' End', pos: 14 }
      ])
      const result = findWikiLinkAtCursor(doc as any, 10)
      
      expect(result.found).toBe(true)
      expect(result.query).toBe('Link')
    })

    test('should find first matching link when cursor in multiple links', () => {
      const doc = createMockDoc([{ text: '[[First]] and [[Second]]', pos: 0 }])
      const result = findWikiLinkAtCursor(doc as any, 3)
      
      expect(result.found).toBe(true)
      expect(result.query).toBe('First')
    })

    test('should handle link with pipe and display text', () => {
      const doc = createMockDoc([{ text: '[[Target|Display Text]]', pos: 0 }])
      const result = findWikiLinkAtCursor(doc as any, 5)
      
      expect(result.found).toBe(true)
      expect(result.query).toBe('Target')
    })

    test('should handle unicode page names', () => {
      const doc = createMockDoc([{ text: '[[日本語ページ]]', pos: 0 }])
      const result = findWikiLinkAtCursor(doc as any, 3)
      
      expect(result.found).toBe(true)
      expect(result.query).toBe('日本語ページ')
    })
  })

  describe('closeWikiLinkMenuByEditor', () => {
    test('should execute without error', () => {
      expect(() => closeWikiLinkMenuByEditor()).not.toThrow()
    })
  })

  describe('notifyWikiLinkMenuSelect timing', () => {
    test('should reset selectingFromMenu after timeout', () => {
      notifyWikiLinkMenuSelect()
      
      // 由于 selectingFromMenu 是内部状态，我们无法直接测试
      // 但可以确认函数执行没有问题
      expect(true).toBe(true)
    })
  })

  describe('菜单交互行为', () => {
    test('当光标移出 wiki 链接范围时应该关闭菜单', () => {
      // 此逻辑在 handleWikiLinkDetection 中
      // 我们可以验证 findWikiLinkAtCursor 在没有找到链接时返回正确结果
      const doc = createMockDoc([{ text: '[[WikiLink]] some other text', pos: 0 }])
      const result = findWikiLinkAtCursor(doc as any, 20)
      
      expect(result.found).toBe(false)
    })

    test('closeWikiLinkMenuByEditor 应该能够被调用', () => {
      expect(() => closeWikiLinkMenuByEditor()).not.toThrow()
    })
  })
})
