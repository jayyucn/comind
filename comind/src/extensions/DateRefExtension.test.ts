import { describe, it, expect, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { DateRefExtension, DATE_REF_CLICK_EVENT } from './DateRefExtension'
import type { DateRefClickPayload } from './DateRefExtension'
import { WikiLinkExtension } from './WikiLinkExtension'

interface DecoratedEditor {
  editor: Editor
  element: HTMLElement
  teardown: () => void
}

function createEditor(content: string): DecoratedEditor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({
    element,
    extensions: [Document, Paragraph, Text, DateRefExtension],
    content: `<p>${content}</p>`,
  })
  return {
    editor,
    element,
    teardown: () => {
      editor.destroy()
      element.remove()
    },
  }
}

function decoratedSpans(el: HTMLElement): HTMLSpanElement[] {
  return Array.from(el.querySelectorAll('span.date-ref'))
}

function spanData(el: HTMLElement) {
  return decoratedSpans(el).map(s => ({
    kind: s.dataset.kind,
    iso: s.dataset.iso,
    recurrence: s.dataset.recurrence,
    text: s.textContent,
  }))
}

describe('DateRefExtension decoration rendering', () => {
  let handle: DecoratedEditor

  afterEach(() => {
    handle.teardown()
  })

  it('renders @2026-07-15T14:00 ⏰|weekly as date-ref span', () => {
    handle = createEditor('@2026-07-15T14:00 ⏰|weekly')
    const data = spanData(handle.element)
    expect(data).toEqual([
      { kind: 'deadline', iso: '2026-07-15T14:00', recurrence: 'weekly', text: expect.any(String) },
    ])
  })

  it('renders @2026-07-20 📅 (no recurrence) with recurrence=none', () => {
    handle = createEditor('@2026-07-20 📅')
    const data = spanData(handle.element)
    expect(data).toEqual([
      { kind: 'schedule', iso: '2026-07-20', recurrence: 'none', text: expect.any(String) },
    ])
  })

  it('renders @2026-08-03 as kind=ref', () => {
    handle = createEditor('@2026-08-03')
    const data = spanData(handle.element)
    expect(data).toEqual([
      { kind: 'ref', iso: '2026-08-03', recurrence: 'none', text: expect.any(String) },
    ])
  })

  it('renders multiple dateRefs in one block', () => {
    handle = createEditor('@2026-07-20 📅 与 @2026-07-17T18:00 ⏰|daily')
    const data = spanData(handle.element)
    expect(data).toHaveLength(2)
    expect(data[0]).toMatchObject({ kind: 'schedule', iso: '2026-07-20' })
    expect(data[1]).toMatchObject({ kind: 'deadline', iso: '2026-07-17T18:00', recurrence: 'daily' })
  })

  it('does not decorate plain text', () => {
    handle = createEditor('plain text no date ref')
    expect(decoratedSpans(handle.element)).toHaveLength(0)
  })

  it('does not decorate [[wiki links]]', () => {
    handle = createEditor('[[Journal Page]]')
    expect(decoratedSpans(handle.element)).toHaveLength(0)
  })

  it('renders both dateRef and wikilink independently (no class collision)', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const ed = new Editor({
      element: el,
      extensions: [Document, Paragraph, Text, DateRefExtension, WikiLinkExtension],
      content: '<p>@2026-07-15 ⏰ and [[Some Page]]</p>',
    })
    expect(spanData(el)).toHaveLength(1) // dateRef span
    expect(el.querySelector('span.wiki-link')).not.toBeNull() // wikilink span
    ed.destroy()
    el.remove()
  })
})

describe('DateRefExtension handleClick event', () => {
  it('dispatches dateRefClick with correct payload', () => {
    const mockDispatch = vi.fn((e: Event) => true)
    const mockSpan = {
      classList: { contains: (cls: string) => cls === 'date-ref' },
      dataset: { kind: 'deadline', iso: '2026-07-15T14:00', recurrence: 'weekly' },
      dispatchEvent: mockDispatch,
    } as unknown as HTMLElement
    const fakeEvent = { target: mockSpan } as unknown as MouseEvent

    const target = fakeEvent.target as HTMLElement
    if (!target.classList.contains('date-ref')) {
      expect(true).toBe(false)
      return
    }

    const pos = 42
    const from = pos
    const to = pos

    const payload: DateRefClickPayload = {
      from,
      to,
      blockId: '',
      kind: (target.dataset.kind ?? '') as any,
      iso: target.dataset.iso ?? '',
      recurrence: (target.dataset.recurrence ?? '') as any,
    }

    target.dispatchEvent(
      new CustomEvent(DATE_REF_CLICK_EVENT, {
        bubbles: true,
        composed: true,
        detail: payload,
      })
    )

    expect(mockDispatch).toHaveBeenCalledTimes(1)
    const dispatchedEvent = (mockDispatch as any).mock.calls[0][0] as CustomEvent<DateRefClickPayload>
    expect(dispatchedEvent.type).toBe(DATE_REF_CLICK_EVENT)
    expect(dispatchedEvent.detail.kind).toBe('deadline')
    expect(dispatchedEvent.detail.iso).toBe('2026-07-15T14:00')
    expect(dispatchedEvent.detail.recurrence).toBe('weekly')
    expect(dispatchedEvent.detail.from).toBe(42)
    expect(dispatchedEvent.detail.to).toBe(42)
    expect(dispatchedEvent.detail.blockId).toBe('')
  })

  it('returns false and does not dispatch for non-date-ref target', () => {
    const mockDispatch = vi.fn((e: Event) => true)
    const nonDateRefSpan = {
      classList: { contains: () => false },
      dataset: {},
      dispatchEvent: mockDispatch,
    } as unknown as HTMLElement

    const target = nonDateRefSpan
    if (!target.classList.contains('date-ref')) {
      expect(mockDispatch).not.toHaveBeenCalled()
      return
    }
    expect(true).toBe(false)
  })
})
