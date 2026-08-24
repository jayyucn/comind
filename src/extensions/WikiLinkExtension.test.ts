import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { WikiLinkExtension } from './WikiLinkExtension'
import { useRelationshipTypes } from '../composables/useRelationshipTypes'
import { cleanupRelationshipTypes } from '../../tests/core-client'

interface DecoratedEditor {
  editor: Editor
  element: HTMLElement
  renderedHTML: string
}

function createDecoratedEditor(content: string): DecoratedEditor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({
    element,
    extensions: [Document, Paragraph, Text, WikiLinkExtension],
    content: `<p>${content}</p>`
  })
  return { editor, element, renderedHTML: element.innerHTML }
}

function destroyDecoratedEditor(handle: DecoratedEditor): void {
  handle.editor.destroy()
  handle.element.remove()
}

/**
 * Collect data-page of all spans that have class="block-link".
 * The plugin sets `class` and `data-page` together on a single span,
 * so this gives the pages that are decorated as wiki-links.
 */
function decoratedPages(handle: DecoratedEditor): string[] {
  const spans = handle.element.querySelectorAll('span.block-link')
  return Array.from(spans).map(s => s.getAttribute('data-page') ?? '')
}

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

  describe('WikiLinkExtension decoration behavior', () => {
    beforeEach(async () => {
      await cleanupRelationshipTypes()
      const { _resetForTest } = useRelationshipTypes()
      _resetForTest()
      const { load } = useRelationshipTypes()
      await load()
    })

    afterEach(async () => {
      await cleanupRelationshipTypes()
      const { _resetForTest } = useRelationshipTypes()
      _resetForTest()
    })

    it('普通 [[X]] 应渲染 wiki-link 装饰', () => {
      const handle = createDecoratedEditor('See [[X]] for details')
      const pages = decoratedPages(handle)
      expect(pages).toContain('X')
      expect(handle.renderedHTML).toContain('block-link')
      expect(handle.renderedHTML).toContain('data-page="X"')
      destroyDecoratedEditor(handle)
    })

    it('编辑态 ((label))[[X]]：类型段有 relationship-bracket + rel-type-label 装饰，[[X]] 有 block-link 装饰', () => {
      const handle = createDecoratedEditor('前置 ((是一个))[[项目A]] 后置')
      const html = handle.renderedHTML
      // (( 和 )) 段：relationship-bracket 浅色
      expect(html).toContain('relationship-bracket')
      // label 段：rel-type-label + --rel-color 内联色（is-a 的 #1890ff）
      expect(html).toContain('rel-type-label')
      expect(html).toContain('--rel-color')
      // [[X]] 走普通 wiki-link 装饰：有 block-link + data-page
      expect(html).toContain('block-link')
      expect(html).toContain('data-page="项目A"')
      destroyDecoratedEditor(handle)
    })

    it('编辑态 ((label!)) auto-inverse 与 ((label<->inverseLabel)) 双向都能装饰', () => {
      const h1 = createDecoratedEditor('((依赖!))[[A]]')
      expect(h1.renderedHTML).toContain('rel-type-label')
      expect(h1.renderedHTML).toContain('--rel-color')
      destroyDecoratedEditor(h1)

      const h2 = createDecoratedEditor('((依赖<->被依赖))[[B]]')
      expect(h2.renderedHTML).toContain('rel-type-label')
      expect(h2.renderedHTML).toContain('--rel-color')
      destroyDecoratedEditor(h2)
    })
  })
})
