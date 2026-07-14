import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { PluginKey } from '@tiptap/pm/state'
import { DecorationSet } from '@tiptap/pm/view'
import { DateRefExtension, DATE_REF_CLICK_EVENT } from './DateRefExtension'
import { WikiLinkExtension } from './WikiLinkExtension'
import type { DateRefClickPayload } from './DateRefExtension'

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

  it('renders {{deadline:2026-07-15T14:00|weekly}} as date-ref span', () => {
    handle = createEditor('{{deadline:2026-07-15T14:00|weekly}}')
    const data = spanData(handle.element)
    expect(data).toEqual([
      { kind: 'deadline', iso: '2026-07-15T14:00', recurrence: 'weekly', text: expect.any(String) },
    ])
  })

  it('renders {{schedule:2026-07-20}} (no recurrence) with recurrence=none', () => {
    handle = createEditor('{{schedule:2026-07-20}}')
    const data = spanData(handle.element)
    expect(data).toEqual([
      { kind: 'schedule', iso: '2026-07-20', recurrence: 'none', text: expect.any(String) },
    ])
  })

  it('renders multiple dateRefs in one block', () => {
    handle = createEditor('{{schedule:2026-07-20}} 与 {{deadline:2026-07-17T18:00|daily}}')
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

  it('does not decorate {{unknownkind:2026-07-15}} (invalid kind)', () => {
    handle = createEditor('{{unknown:2026-07-15}}')
    expect(decoratedSpans(handle.element)).toHaveLength(0)
  })

  it('renders both dateRef and wikilink independently (no class collision)', () => {
    // 两个扩展各自独立渲染，不共享 class
    const el = document.createElement('div')
    document.body.appendChild(el)
    const ed = new Editor({
      element: el,
      extensions: [Document, Paragraph, Text, DateRefExtension, WikiLinkExtension],
      content: '<p>{{deadline:2026-07-15}} and [[Some Page]]</p>',
    })
    expect(spanData(el)).toHaveLength(1) // dateRef span
    expect(el.querySelector('span.wiki-link')).not.toBeNull() // wikilink span
    ed.destroy()
    el.remove()
  })
})

describe('DateRefExtension handleClick event', () => {
  // 这个测试独立创建 editor，不依赖 handle 变量
  it('handleClick dispatches dateRefClick with correct payload', () => {
    const plugins = DateRefExtension.addProseMirrorPlugins()
    const pmPlugin = plugins[0]
    expect(pmPlugin).toBeDefined()
    expect(typeof pmPlugin.props?.handleClick).toBe('function')

    const el = document.createElement('div')
    document.body.appendChild(el)
    const ed = new Editor({
      element: el,
      extensions: [Document, Paragraph, Text, DateRefExtension],
      content: '<p>{{deadline:2026-07-15T14:00|weekly}}</p>',
    })

    const span = decoratedSpans(el)[0]
    let received: CustomEvent<DateRefClickPayload> | null = null
    const listener = (e: Event) => { received = e as CustomEvent<DateRefClickPayload> }
    span.addEventListener(DATE_REF_CLICK_EVENT, listener)

    // 找到 '{{deadline' 在文档中的位置
    let targetPos = 0
    ed.state.doc.descendants((node: any, pos: number) => {
      if (node.isText && node.text?.includes('{{deadline')) targetPos = pos
    })

    // 替换 pmPlugin.key.getState，返回含1个 decoration 的 DecorationSet
    const origGetState = pmPlugin.key.getState.bind(pmPlugin.key)
    pmPlugin.key.getState = () => mockPluginState

    const mockPluginState = DecorationSet.create(ed.state.doc, [])
    const fakeEvent = { target: span } as unknown as MouseEvent
    // @ts-ignore - 仅提供 handleClick 需要的字段
    const ret = pmPlugin.props.handleClick!({ state: ed.state }, targetPos + 2, fakeEvent)

    pmPlugin.key.getState = origGetState // restore

    expect(ret).toBe(true)
    expect(received).not.toBeNull()
    expect(received!.detail.kind).toBe('deadline')
    expect(received!.detail.iso).toBe('2026-07-15T14:00')
    expect(received!.detail.recurrence).toBe('weekly')
    expect(received!.detail.blockId).toBe('')

    span.removeEventListener(DATE_REF_CLICK_EVENT, listener)
    ed.destroy()
    el.remove()
  })
})
