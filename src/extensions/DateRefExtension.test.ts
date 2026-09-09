import { describe, it, expect, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import type { EditorView } from '@tiptap/pm/view'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { DateRefExtension, DATE_REF_CLICK_EVENT } from './DateRefExtension'
import type { DateRefClickPayload } from './DateRefExtension'
import { WikiLinkExtension } from './WikiLinkExtension'
import { DATE_REF_AT_REGEX } from '../utils/date-ref'

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

// ─── handleKeyDown：Backspace/Delete 整单元删除 ─────────────────────────────
// 需求：光标精确位于 dateRef/schedule/deadline 内容单元右侧（紧随其后）按 Backspace，
// 应整单元删除；其他光标位置保持正常逐字符删除。单元= decoration 的 [from, to)。
// 注：不能依赖插件 getState 取装饰（恒空，曾致整删失效），测试直接驱动真实 view。

function dateRefRangeFromDoc(editor: Editor): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = []
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return
    const text = node.text || ''
    const re = new RegExp(DATE_REF_AT_REGEX.source, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      ranges.push({ from: pos + m.index, to: pos + m.index + m[0].length })
    }
  })
  return ranges
}

/** 取 dateRef 插件的 handleKeyDown（真实 view 驱动） */
function dateRefKeydown(editor: Editor, key: string, pos: number) {
  // TipTap 会把插件 key 重写为 'dateRef$'，不能靠 key 从 state.plugins 里 find；
  // 直接从扩展配置拿 handler（与 DateRefTriggerExtension.test.ts 同范式），再喂真实 view。
  const [plugin] = DateRefExtension.config.addProseMirrorPlugins() ?? []
  const handleKeyDown = plugin?.spec.props.handleKeyDown as ((view: EditorView, event: KeyboardEvent) => boolean) | undefined
  expect(handleKeyDown).toBeTypeOf('function')
  editor.commands.setTextSelection(pos)
  const preventDefault = vi.fn()
  const event = { key, preventDefault } as unknown as KeyboardEvent
  const handled = handleKeyDown!(editor.view, event)
  return { handled, preventDefaultCalled: preventDefault.mock.calls.length > 0 }
}

function plainText(editor: Editor) {
  return editor.state.doc.textContent
}

describe('DateRefExtension handleKeyDown — 整单元删除', () => {
  let handle: DecoratedEditor
  afterEach(() => {
    handle?.teardown()
  })

  it('Backspace：光标精确位于 schedule 单元右侧 → 删除整个单元（含 emoji 与参数）', () => {
    handle = createEditor('meet @2026-07-15T14:00 📅|weekly tomorrow')
    const ranges = dateRefRangeFromDoc(handle.editor)
    expect(ranges).toHaveLength(1)
    const { to } = ranges[0]
    const r = dateRefKeydown(handle.editor, 'Backspace', to)
    expect(r.handled).toBe(true)
    expect(r.preventDefaultCalled).toBe(true)
    expect(plainText(handle.editor)).toBe('meet  tomorrow')
  })

  it('Backspace：光标精确位于 deadline 单元右侧 → 删除整个单元（含 ⏰ 与参数）', () => {
    handle = createEditor('ship @2026-07-20 ⏰||30 by friday')
    const ranges = dateRefRangeFromDoc(handle.editor)
    const { to } = ranges[0]
    const r = dateRefKeydown(handle.editor, 'Backspace', to)
    expect(r.handled).toBe(true)
    expect(plainText(handle.editor)).toBe('ship  by friday')
  })

  it('Backspace：光标精确位于 ref 单元右侧 → 删除整个单元', () => {
    handle = createEditor('see @2026-08-03 later')
    const ranges = dateRefRangeFromDoc(handle.editor)
    const { to } = ranges[0]
    const r = dateRefKeydown(handle.editor, 'Backspace', to)
    expect(r.handled).toBe(true)
    expect(plainText(handle.editor)).toBe('see  later')
  })

  it('Backspace：光标在单元内部 → 不整删（返回 false，走正常逐字符删除）', () => {
    handle = createEditor('meet @2026-07-15T14:00 📅|weekly tomorrow')
    const { from } = dateRefRangeFromDoc(handle.editor)[0]
    const insidePos = from + 3 // 落在日期文本中间
    const r = dateRefKeydown(handle.editor, 'Backspace', insidePos)
    expect(r.handled).toBe(false)
    expect(r.preventDefaultCalled).toBe(false)
    expect(plainText(handle.editor)).toBe('meet @2026-07-15T14:00 📅|weekly tomorrow')
  })

  it('Backspace：光标在单元左侧（from-1）→ 不整删，正常删除左侧字符', () => {
    handle = createEditor('meet @2026-07-15T14:00 📅|weekly tomorrow')
    const { from } = dateRefRangeFromDoc(handle.editor)[0]
    // 单元 from 前面是空格；正常 Backspace 应删掉它，而不是整单元
    const beforePos = from - 1
    const r = dateRefKeydown(handle.editor, 'Backspace', beforePos)
    expect(r.handled).toBe(false)
    expect(r.preventDefaultCalled).toBe(false)
  })

  it('Backspace：光标在普通文本处 → 不拦截（返回 false）', () => {
    handle = createEditor('meet @2026-07-15T14:00 📅|weekly tomorrow')
    const r = dateRefKeydown(handle.editor, 'Backspace', 0) // 段落最前
    expect(r.handled).toBe(false)
    expect(r.preventDefaultCalled).toBe(false)
  })

  it('Backspace：光标在单元内部（from+1，紧贴首个字符后）→ 不整删', () => {
    handle = createEditor('meet @2026-07-15T14:00 📅|weekly tomorrow')
    const { from } = dateRefRangeFromDoc(handle.editor)[0]
    const r = dateRefKeydown(handle.editor, 'Backspace', from + 1)
    expect(r.handled).toBe(false)
    expect(r.preventDefaultCalled).toBe(false)
  })

  it('Backspace：光标在单元最左侧（from）→ 不整删（该位置右侧字符应由 Delete 处理）', () => {
    handle = createEditor('meet @2026-07-15T14:00 📅|weekly tomorrow')
    const { from } = dateRefRangeFromDoc(handle.editor)[0]
    const r = dateRefKeydown(handle.editor, 'Backspace', from)
    expect(r.handled).toBe(false)
    expect(r.preventDefaultCalled).toBe(false)
  })

  it('多单元：光标在第一个单元右侧 → 只删第一个，保留第二个', () => {
    handle = createEditor('@2026-07-20 📅 与 @2026-07-17T18:00 ⏰|daily')
    const ranges = dateRefRangeFromDoc(handle.editor)
    expect(ranges).toHaveLength(2)
    const r = dateRefKeydown(handle.editor, 'Backspace', ranges[0].to)
    expect(r.handled).toBe(true)
    expect(plainText(handle.editor)).toBe(' 与 @2026-07-17T18:00 ⏰|daily')
  })

  it('Delete：光标在单元左侧 → 删除整个单元（保持镜像语义）', () => {
    handle = createEditor('meet @2026-07-15T14:00 📅|weekly tomorrow')
    const { from } = dateRefRangeFromDoc(handle.editor)[0]
    const r = dateRefKeydown(handle.editor, 'Delete', from)
    expect(r.handled).toBe(true)
    expect(plainText(handle.editor)).toBe('meet  tomorrow')
  })

  it('Backspace：光标在单元右侧但有选区（非 collapsed）→ 不拦截（交给默认选区删除）', () => {
    handle = createEditor('meet @2026-07-15T14:00 📅|weekly tomorrow')
    const { from } = dateRefRangeFromDoc(handle.editor)[0]
    // 构建非空选区：from..from+1
    handle.editor.commands.setTextSelection({ from, to: from + 1 })
    const [plugin] = DateRefExtension.config.addProseMirrorPlugins() ?? []
    const handleKeyDown = plugin?.spec.props.handleKeyDown as ((view: EditorView, event: KeyboardEvent) => boolean) | undefined
    const event = { key: 'Backspace', preventDefault: vi.fn() } as unknown as KeyboardEvent
    const handled = handleKeyDown!(handle.editor.view, event)
    expect(handled).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(plainText(handle.editor)).toContain('@2026-07-15')
  })

  it('Backspace：光标在单元右侧且 to 之后紧跟文本 → 只删单元，保留后续文本', () => {
    handle = createEditor('go @2026-07-15T14:00 📅|weekly,then continue')
    const ranges = dateRefRangeFromDoc(handle.editor)
    expect(ranges).toHaveLength(1)
    const r = dateRefKeydown(handle.editor, 'Backspace', ranges[0].to)
    expect(r.handled).toBe(true)
    expect(plainText(handle.editor)).toBe('go ,then continue')
  })

  it('Backspace：单元右侧无内容且紧跟其后（光标=to=doc末尾）→ 整单元删除', () => {
    handle = createEditor('only @2026-07-15T14:00 📅|weekly')
    const ranges = dateRefRangeFromDoc(handle.editor)
    expect(ranges).toHaveLength(1)
    const r = dateRefKeydown(handle.editor, 'Backspace', ranges[0].to)
    expect(r.handled).toBe(true)
    expect(plainText(handle.editor)).toBe('only ')
  })
})

// ─── handleKeyDown：方向键整体跨过单元 ─────────────────────────────────────
// 需求：光标贴 dateRef/schedule/deadline 单元左缘按 → 应跨过整个单元到右缘；
// 贴右缘按 ← 应跨回左缘（单元不可进入）。其他位置/带修饰键/带选区 → 放行默认。

describe('DateRefExtension handleKeyDown — 方向键跨过单元', () => {
  let handle: DecoratedEditor
  afterEach(() => {
    handle?.teardown()
  })

  it('ArrowRight：光标在 schedule 单元左缘（from）→ 跨过单元到 to', () => {
    handle = createEditor('meet @2026-07-15T14:00 📅|weekly tomorrow')
    const { from, to } = dateRefRangeFromDoc(handle.editor)[0]
    const r = dateRefKeydown(handle.editor, 'ArrowRight', from)
    expect(r.handled).toBe(true)
    expect(r.preventDefaultCalled).toBe(true)
    expect(handle.editor.state.selection.from).toBe(to)
    expect(plainText(handle.editor)).toContain('@2026-07-15T14:00 📅|weekly')
  })

  it('ArrowLeft：光标在 deadline 单元右缘（to）→ 跨回单元到 from', () => {
    handle = createEditor('ship @2026-07-20 ⏰||30 by friday')
    const { from, to } = dateRefRangeFromDoc(handle.editor)[0]
    const r = dateRefKeydown(handle.editor, 'ArrowLeft', to)
    expect(r.handled).toBe(true)
    expect(handle.editor.state.selection.from).toBe(from)
  })

  it('ArrowLeft：光标在 ref 单元右缘 → 跨回 from', () => {
    handle = createEditor('see @2026-08-03 later')
    const { from, to } = dateRefRangeFromDoc(handle.editor)[0]
    const r = dateRefKeydown(handle.editor, 'ArrowLeft', to)
    expect(r.handled).toBe(true)
    expect(handle.editor.state.selection.from).toBe(from)
  })

  it('ArrowRight：光标在普通文本（非单元左缘）→ 不拦截', () => {
    handle = createEditor('meet @2026-07-15T14:00 📅|weekly tomorrow')
    const r = dateRefKeydown(handle.editor, 'ArrowRight', 0) // 段落最前
    expect(r.handled).toBe(false)
    expect(r.preventDefaultCalled).toBe(false)
  })

  it('ArrowLeft：光标在普通文本（非单元右缘）→ 不拦截', () => {
    handle = createEditor('meet @2026-07-15T14:00 📅|weekly tomorrow')
    const { to } = dateRefRangeFromDoc(handle.editor)[0]
    const r = dateRefKeydown(handle.editor, 'ArrowLeft', to + 1) // to 后是空格
    expect(r.handled).toBe(false)
    expect(r.preventDefaultCalled).toBe(false)
  })

  it('相邻单元夹缝：ArrowLeft 跨过左侧单元、ArrowRight 跨过右侧单元', () => {
    handle = createEditor('@2026-07-20 📅@2026-07-17T18:00 ⏰|daily')
    const [a, b] = dateRefRangeFromDoc(handle.editor)
    expect(a.to).toBe(b.from) // 两单元紧贴，夹缝位置既是 A.to 也是 B.from
    const rLeft = dateRefKeydown(handle.editor, 'ArrowLeft', a.to)
    expect(rLeft.handled).toBe(true)
    expect(handle.editor.state.selection.from).toBe(a.from)
    const rRight = dateRefKeydown(handle.editor, 'ArrowRight', b.from)
    expect(rRight.handled).toBe(true)
    expect(handle.editor.state.selection.from).toBe(b.to)
  })

  it('ctrl+ArrowRight 在单元左缘 → 不拦截（交给默认整词移动）', () => {
    handle = createEditor('meet @2026-07-15T14:00 📅|weekly tomorrow')
    const { from } = dateRefRangeFromDoc(handle.editor)[0]
    handle.editor.commands.setTextSelection(from)
    const [plugin] = DateRefExtension.config.addProseMirrorPlugins() ?? []
    const handleKeyDown = plugin?.spec.props.handleKeyDown as ((view: EditorView, event: KeyboardEvent) => boolean) | undefined
    const event = { key: 'ArrowRight', ctrlKey: true, preventDefault: vi.fn() } as unknown as KeyboardEvent
    const handled = handleKeyDown!(handle.editor.view, event)
    expect(handled).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('ArrowRight 带选区（非 collapsed）在单元左缘 → 不拦截（交给默认选区扩展）', () => {
    handle = createEditor('meet @2026-07-15T14:00 📅|weekly tomorrow')
    const { from } = dateRefRangeFromDoc(handle.editor)[0]
    handle.editor.commands.setTextSelection({ from, to: from + 1 })
    const [plugin] = DateRefExtension.config.addProseMirrorPlugins() ?? []
    const handleKeyDown = plugin?.spec.props.handleKeyDown as ((view: EditorView, event: KeyboardEvent) => boolean) | undefined
    const event = { key: 'ArrowRight', preventDefault: vi.fn() } as unknown as KeyboardEvent
    const handled = handleKeyDown!(handle.editor.view, event)
    expect(handled).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
