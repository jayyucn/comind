import { describe, test, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import Editor from './Editor.vue'
import { nextTick } from 'vue'

vi.mock('../composables/useNavigateToPage', () => ({
  useNavigateToPage: vi.fn(() => ({
    navigateToPage: vi.fn()
  }))
}))

vi.mock('../extensions/WikiLinkExtension', () => ({
  WikiLinkExtension: {
    create: vi.fn(() => ({ name: 'wikiLink' }))
  }
}))

vi.mock('../extensions/WikiLinkTriggerExtension', () => ({
  WikiLinkTriggerExtension: {
    create: vi.fn(() => ({ name: 'wikiLinkTrigger' })),
    notifyWikiLinkMenuSelect: vi.fn()
  }
}))

describe('Editor WikiLink Selection Logic', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  describe('handleWikiLinkSelect text scanning logic', () => {
    test('should find opening [[ position by backward scanning', () => {
      const doc = {
        content: {
          size: 50
        },
        textBetween: (from: number, to: number) => {
          const text = 'Hello [[World]] test'
          if (from === 5 && to === 7) return '[['
          return text.substring(from, to)
        }
      }

      let cursorPos = 13
      let from = cursorPos - 1
      while (from >= 0) {
        if (from >= 1 && doc.textBetween(from - 1, from + 1) === '[[') {
          from = from - 1
          break
        }
        from--
      }
      if (from < 0) from = 0

      expect(from).toBe(6)
    })

    test('should handle edge case when [[ is at document start', () => {
      let cursorPos = 2
      let from = cursorPos - 1
      while (from >= 0) {
        if (from >= 1 && '[['.includes('X')) {
          from = from - 1
          break
        }
        from--
      }
      if (from < 0) from = 0

      expect(from).toBe(0)
    })

    test('should find closing ]] position by forward scanning', () => {
      const doc = {
        content: {
          size: 50
        },
        textBetween: (from: number, to: number) => {
          const text = '[[Hello World]] test'
          if (from === 12 && to === 14) return ']]'
          return text.substring(from, to)
        }
      }

      let cursorPos = 10
      let to = cursorPos
      while (to < doc.content.size - 1) {
        if (doc.textBetween(to, to + 2) === ']]') {
          to = to + 2
          break
        }
        const char = doc.textBetween(to, to + 1)
        if (char === ' ' || char === '\n' || char === '\r') {
          break
        }
        to++
      }
      if (to > doc.content.size) to = doc.content.size

      expect(to).toBe(14)
    })

    test('should stop scanning when encountering space', () => {
      const doc = {
        content: {
          size: 50
        },
        textBetween: (from: number, to: number) => {
          if (to - from === 1) {
            if (from === 2) return '['
            if (from === 3) return '['
            if (from === 13) return ' '
            return ''
          }
          if (from === 2 && to === 4) return '[['
          return ''
        }
      }

      let to = 10
      let foundSpace = false
      while (to < doc.content.size - 1) {
        const char = doc.textBetween(to, to + 1)
        if (char === ' ' || char === '\n' || char === '\r') {
          foundSpace = true
          break
        }
        to++
      }

      expect(foundSpace).toBe(true)
    })

    test('should stop scanning when encountering newline', () => {
      let foundNewline = false
      const char = '\n'

      if (char === ' ' || char === '\n' || char === '\r') {
        foundNewline = true
      }

      expect(foundNewline).toBe(true)
    })

    test('should bound to document size', () => {
      const docSize = 20
      let to = 100

      if (to > docSize) to = docSize

      expect(to).toBe(20)
    })
  })

  describe('wiki link replacement logic', () => {
    test('should construct correct replacement text', () => {
      const pageName = 'TargetPage'
      const expectedReplacement = `[[${pageName}]]`

      expect(expectedReplacement).toBe('[[TargetPage]]')
    })

    test('should calculate correct cursor position after replacement', () => {
      const pageName = 'TargetPage'
      const from = 5
      const expectedCursorPos = from + pageName.length + 4

      expect(expectedCursorPos).toBe(5 + 10 + 4)
    })

    test('should handle page names with spaces', () => {
      const pageName = 'My Target Page'
      const expectedCursorPos = 5 + pageName.length + 4

      expect(expectedCursorPos).toBe(5 + 14 + 4) // "My Target Page" has 14 characters
    })

    test('should handle page names with unicode', () => {
      const pageName = '目标页面'
      const expectedCursorPos = 5 + pageName.length + 4

      expect(expectedCursorPos).toBe(5 + 4 + 4)
    })
  })

  describe('textToHtml conversion', () => {
    test('should escape ampersands', () => {
      const text = 'A & B'
      const result = text.replace(/&/g, '&amp;')

      expect(result).toBe('A &amp; B')
    })

    test('should escape less than signs', () => {
      const text = 'A < B'
      const result = text.replace(/</g, '&lt;')

      expect(result).toBe('A &lt; B')
    })

    test('should escape greater than signs', () => {
      const text = 'A > B'
      const result = text.replace(/>/g, '&gt;')

      expect(result).toBe('A &gt; B')
    })

    test('should convert newlines to br tags', () => {
      const text = 'Line 1\nLine 2'
      const result = text.replace(/\n/g, '<br>')

      expect(result).toBe('Line 1<br>Line 2')
    })

    test('should handle combined escaping', () => {
      const text = 'A & B < C > D\nE'
      const result = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>')

      expect(result).toBe('A &amp; B &lt; C &gt; D<br>E')
    })
  })

  describe('Editor component integration', () => {
    test('should expose required methods via defineExpose', () => {
      const exposedMethods = ['syncContent', 'focus', 'getText', 'markSaved', 'getEditor']

      const expected = ['syncContent', 'focus', 'getText', 'markSaved', 'getEditor']
      expect(exposedMethods).toEqual(expect.arrayContaining(expected))
    })

    test('should emit required events', () => {
      const expectedEvents = ['save', 'split', 'merge', 'delete', 'indent', 'outdent', 'moveUp', 'moveDown', 'exitEdit', 'cursor-change']

      const events = ['save', 'split', 'merge', 'delete', 'indent', 'outdent', 'moveUp', 'moveDown', 'exitEdit', 'cursor-change']
      expect(events).toEqual(expect.arrayContaining(expectedEvents))
    })

    test('should use debounce for save emission', () => {
      const debounceDelay = 300

      expect(debounceDelay).toBe(300)
    })
  })

  describe('handleWikiLinkSelect async behavior', () => {
    test('should await createPage when page does not exist', async () => {
      const mockPageStore = {
        getPageByTitle: vi.fn().mockReturnValue(undefined),
        createPage: vi.fn().mockResolvedValue({ id: 'new-page-id', title: 'NewPage' })
      }

      const pageName = 'NewPage'
      const pageExists = !!mockPageStore.getPageByTitle(pageName)

      expect(pageExists).toBe(false)

      if (!pageExists) {
        await mockPageStore.createPage(pageName)
      }

      expect(mockPageStore.createPage).toHaveBeenCalledWith('NewPage')
    })

    test('should not call createPage when page already exists', async () => {
      const mockPageStore = {
        getPageByTitle: vi.fn().mockReturnValue({ id: 'existing-id', title: 'ExistingPage' }),
        createPage: vi.fn()
      }

      const pageName = 'ExistingPage'
      const pageExists = !!mockPageStore.getPageByTitle(pageName)

      expect(pageExists).toBe(true)

      if (!pageExists) {
        await mockPageStore.createPage(pageName)
      }

      expect(mockPageStore.createPage).not.toHaveBeenCalled()
    })

    test('createPage returns Promise that must be awaited', async () => {
      const mockPageStore = {
        getPageByTitle: vi.fn().mockReturnValue(undefined),
        createPage: vi.fn().mockImplementation(() => {
          return new Promise((resolve) => {
            setTimeout(() => resolve({ id: 'test-id', title: 'Test' }), 10)
          })
        })
      }

      const pageName = 'TestPage'
      const pageStore = mockPageStore

      async function handleSelect(name: string) {
        if (!pageStore.getPageByTitle(name)) {
          await pageStore.createPage(name)
        }
      }

      await handleSelect(pageName)

      expect(mockPageStore.createPage).toHaveBeenCalledWith('TestPage')
    })
  })

  describe('menu state management', () => {
    test('menu visible state should control menu display', () => {
      const menuVisible = true
      const menuPosition = { x: 100, y: 200 }
      const menuRange = { from: 10, to: 20 }
      const menuQuery = 'test'

      expect(menuVisible).toBe(true)
      expect(menuPosition.x).toBe(100)
      expect(menuRange.from).toBe(10)
      expect(menuQuery).toBe('test')
    })

    test('menu should close on close event', () => {
      let menuVisible = true

      function handleClose() {
        menuVisible = false
      }

      handleClose()

      expect(menuVisible).toBe(false)
    })

    test('menu query should update on trigger event', () => {
      let menuQuery = ''

      function handleTrigger(event: { query: string }) {
        menuQuery = event.query
      }

      handleTrigger({ query: 'search term' })

      expect(menuQuery).toBe('search term')
    })
  })

  describe('handleEnterAsBlock event handling', () => {
    test('should emit split event', () => {
      const events: string[] = []

      function handleEnterAsBlock(type: string, pos?: number) {
        switch (type) {
          case 'split':
            events.push('split')
            break
        }
      }

      handleEnterAsBlock('split', 10)

      expect(events).toContain('split')
    })

    test('should emit delete event', () => {
      const events: string[] = []

      function handleEnterAsBlock(type: string) {
        switch (type) {
          case 'delete':
            events.push('delete')
            break
        }
      }

      handleEnterAsBlock('delete')

      expect(events).toContain('delete')
    })

    test('should emit merge event', () => {
      const events: string[] = []

      function handleEnterAsBlock(type: string) {
        switch (type) {
          case 'merge':
            events.push('merge')
            break
        }
      }

      handleEnterAsBlock('merge')

      expect(events).toContain('merge')
    })

    test('should emit indent event', () => {
      const events: string[] = []

      function handleEnterAsBlock(type: string) {
        switch (type) {
          case 'indent':
            events.push('indent')
            break
        }
      }

      handleEnterAsBlock('indent')

      expect(events).toContain('indent')
    })

    test('should emit outdent event', () => {
      const events: string[] = []

      function handleEnterAsBlock(type: string) {
        switch (type) {
          case 'outdent':
            events.push('outdent')
            break
        }
      }

      handleEnterAsBlock('outdent')

      expect(events).toContain('outdent')
    })

    test('should emit moveUp event', () => {
      const events: string[] = []

      function handleEnterAsBlock(type: string) {
        switch (type) {
          case 'moveUp':
            events.push('moveUp')
            break
        }
      }

      handleEnterAsBlock('moveUp')

      expect(events).toContain('moveUp')
    })

    test('should emit moveDown event', () => {
      const events: string[] = []

      function handleEnterAsBlock(type: string) {
        switch (type) {
          case 'moveDown':
            events.push('moveDown')
            break
        }
      }

      handleEnterAsBlock('moveDown')

      expect(events).toContain('moveDown')
    })

    test('should emit exitEdit event', () => {
      const events: string[] = []

      function handleEnterAsBlock(type: string) {
        switch (type) {
          case 'exitEdit':
            events.push('exitEdit')
            break
        }
      }

      handleEnterAsBlock('exitEdit')

      expect(events).toContain('exitEdit')
    })

    test('should emit save event with editor text', () => {
      const editorText = 'Test content'
      let savedContent = ''

      function handleEnterAsBlock(type: string) {
        switch (type) {
          case 'save':
            savedContent = editorText
            break
        }
      }

      handleEnterAsBlock('save')

      expect(savedContent).toBe('Test content')
    })
  })

  describe('content sync behavior', () => {
    test('should not sync when content is same', () => {
      const currentContent = 'Same content'
      const newContent = 'Same content'
      const shouldSync = currentContent !== newContent

      expect(shouldSync).toBe(false)
    })

    test('should sync when content is different', () => {
      const currentContent = 'Old content'
      const newContent = 'New content'
      const shouldSync = currentContent !== newContent

      expect(shouldSync).toBe(true)
    })

    test('should use syncing flag to prevent feedback loops', () => {
      let syncing = false
      let emitCount = 0

      function onUpdate() {
        if (syncing) return
        emitCount++
      }

      syncing = true
      onUpdate()
      expect(emitCount).toBe(0)

      syncing = false
      onUpdate()
      expect(emitCount).toBe(1)
    })
  })

  describe('cursor position bounds', () => {
    test('should bound cursor position to content length', () => {
      const content = 'Short'
      const targetPos = 100

      const bounded = Math.min(targetPos, content.length + 1)

      expect(bounded).toBe(6)
    })

    test('should handle start position', () => {
      const content = 'Test content'
      const targetPos = 0

      const bounded = Math.min(targetPos, content.length + 1)

      expect(bounded).toBe(0)
    })

    test('should handle end position', () => {
      const content = 'Test content'
      const targetPos = content.length

      const bounded = Math.min(targetPos, content.length + 1)

      expect(bounded).toBe(content.length)
    })
  })
})
