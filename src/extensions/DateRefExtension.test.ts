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
    expect(el.querySelector('span.block-link')).not.toBeNull() // wikilink span
    ed.destroy()
    el.remove()
  })
})

describe('DateRefExtension handleClick event', () => {
  /** 取 dateRef 装饰插件的 handleClick（真实 view 驱动；键盘插件挂的是 handleKeyDown） */
  function dateRefClickHandler(editor: Editor) {
    const plugins = DateRefExtension.config.addProseMirrorPlugins() ?? []
    const plugin = plugins.find(p => typeof p?.spec?.props?.handleClick === 'function')
    const handleClick = plugin?.spec.props.handleClick as
      | ((view: EditorView, pos: number, event: MouseEvent) => boolean)
      | undefined
    expect(handleClick).toBeTypeOf('function')
    return handleClick!
  }

  it('dispatches dateRefClick with unit range [from,to]（点击落在单元内部）', () => {
    const handle = createEditor('meet @2026-07-15T14:00 📅|weekly tomorrow')
    const unit = dateRefRangeFromDoc(handle.editor)[0]
    const span = decoratedSpans(handle.element)[0]
    expect(span).toBeDefined()

    const dispatched: CustomEvent<DateRefClickPayload>[] = []
    span.addEventListener(DATE_REF_CLICK_EVENT, (e) =>
      dispatched.push(e as CustomEvent<DateRefClickPayload>)
    )

    // 点击落在单元内部（非边界）—— 曾因 getState 恒空退化为 from=to=pos
    const handled = dateRefClickHandler(handle.editor)(
      handle.editor.view,
      unit.from + 3,
      { target: span } as unknown as MouseEvent
    )

    expect(handled).toBe(true)
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].detail.from).toBe(unit.from)
    expect(dispatched[0].detail.to).toBe(unit.to)
    expect(dispatched[0].detail.kind).toBe('schedule')
    expect(dispatched[0].detail.iso).toBe('2026-07-15T14:00')
    expect(dispatched[0].detail.recurrence).toBe('weekly')
    handle.teardown()
  })

  it('returns false and does not dispatch for non-date-ref target', () => {
    const handle = createEditor('meet @2026-07-15T14:00 📅|weekly tomorrow')
    const span = decoratedSpans(handle.element)[0]
    const dispatched: Event[] = []
    span.addEventListener(DATE_REF_CLICK_EVENT, (e) => dispatched.push(e))

    const plain = document.createElement('span')
    const handled = dateRefClickHandler(handle.editor)(
      handle.editor.view,
      1,
      { target: plain } as unknown as MouseEvent
    )

    expect(handled).toBe(false)
    expect(dispatched).toHaveLength(0)
    handle.teardown()
  })
})

// ─── handleKeyDown：Backspace/Delete 整单元删除 ─────────────────────────────
// 需求：date-ref 两侧的 pad 空格属于单元的一部分（整体区间 = 单元 + 紧邻空格）。
// Backspace 光标在单元右侧边界带 [to, R]（含站在右 pad 空格上）→ 整单元删除，
// 右 pad 随单元删、中间保留左 pad 作分隔、行尾不留悬挂空格；Delete 镜像（左缘带 [L, from]）。
// 其他光标位置（单元内部、普通文本）保持正常逐字符删除。单元= decoration 的 [from, to)。
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

/** 取 dateRef 键盘插件的 handleKeyDown（真实 view 驱动） */
function dateRefKeydown(editor: Editor, key: string, pos: number) {
  // 键盘语义已收编至共享原语（inline-unit-keyboard），dateRef 扩展现挂两个插件：
  // 装饰插件（无 handleKeyDown）+ 共享键盘插件。按「带 handleKeyDown」查找，
  // 不再依赖下标顺序（TipTap 会把插件 key 重写为 'dateRef$'，也不能靠 key find）。
  const plugins = DateRefExtension.config.addProseMirrorPlugins() ?? []
  const plugin = plugins.find(p => typeof p?.spec?.props?.handleKeyDown === 'function')
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

  it('Backspace：光标精确位于 schedule 单元右侧 → 删除整体（单元+两侧 pad 空格），保留单空格分隔', () => {
    handle = createEditor('meet @2026-07-15T14:00 📅|weekly tomorrow')
    const ranges = dateRefRangeFromDoc(handle.editor)
    expect(ranges).toHaveLength(1)
    const { to } = ranges[0]
    const r = dateRefKeydown(handle.editor, 'Backspace', to)
    expect(r.handled).toBe(true)
    expect(r.preventDefaultCalled).toBe(true)
    expect(plainText(handle.editor)).toBe('meet tomorrow')
  })

  it('Backspace：光标精确位于 deadline 单元右侧 → 删除整体，保留单空格分隔', () => {
    handle = createEditor('ship @2026-07-20 ⏰||30 by friday')
    const ranges = dateRefRangeFromDoc(handle.editor)
    const { to } = ranges[0]
    const r = dateRefKeydown(handle.editor, 'Backspace', to)
    expect(r.handled).toBe(true)
    expect(plainText(handle.editor)).toBe('ship by friday')
  })

  it('Backspace：光标精确位于 ref 单元右侧 → 删除整体', () => {
    handle = createEditor('see @2026-08-03 later')
    const ranges = dateRefRangeFromDoc(handle.editor)
    const { to } = ranges[0]
    const r = dateRefKeydown(handle.editor, 'Backspace', to)
    expect(r.handled).toBe(true)
    expect(plainText(handle.editor)).toBe('see later')
  })

  it('Backspace：光标站在右 pad 空格上（to+1）→ 删除整个整体（空格属单元，不留悬挂）', () => {
    handle = createEditor('meet @2026-07-15T14:00 📅|weekly tomorrow')
    const { to } = dateRefRangeFromDoc(handle.editor)[0]
    const r = dateRefKeydown(handle.editor, 'Backspace', to + 1)
    expect(r.handled).toBe(true)
    expect(plainText(handle.editor)).toBe('meet tomorrow')
  })

  it('Backspace：行尾单元带尾 pad（doc 末尾）→ 整体删除不留任何空格', () => {
    handle = createEditor('meet @2026-07-15T14:00 📅|weekly ')
    const { to } = dateRefRangeFromDoc(handle.editor)[0]
    const r = dateRefKeydown(handle.editor, 'Backspace', to)
    expect(r.handled).toBe(true)
    expect(plainText(handle.editor)).toBe('meet')
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

  it('多单元：光标在第一个单元右侧 → 只删第一个整体，保留第二个', () => {
    handle = createEditor('@2026-07-20 📅 与 @2026-07-17T18:00 ⏰|daily')
    const ranges = dateRefRangeFromDoc(handle.editor)
    expect(ranges).toHaveLength(2)
    const r = dateRefKeydown(handle.editor, 'Backspace', ranges[0].to)
    expect(r.handled).toBe(true)
    expect(plainText(handle.editor)).toBe('与 @2026-07-17T18:00 ⏰|daily')
  })

  it('Delete：光标在单元左侧 → 删除整个整体（保持镜像语义）', () => {
    handle = createEditor('meet @2026-07-15T14:00 📅|weekly tomorrow')
    const { from } = dateRefRangeFromDoc(handle.editor)[0]
    const r = dateRefKeydown(handle.editor, 'Delete', from)
    expect(r.handled).toBe(true)
    expect(plainText(handle.editor)).toBe('meet tomorrow')
  })

  it('Delete：光标站在左 pad 空格上（from-1）→ 同样删除整个整体', () => {
    handle = createEditor('meet @2026-07-15T14:00 📅|weekly tomorrow')
    const { from } = dateRefRangeFromDoc(handle.editor)[0]
    const r = dateRefKeydown(handle.editor, 'Delete', from - 1)
    expect(r.handled).toBe(true)
    expect(plainText(handle.editor)).toBe('meet tomorrow')
  })

  it('Backspace：光标在单元右侧但有选区（非 collapsed）→ 不拦截（交给默认选区删除）', () => {
    handle = createEditor('meet @2026-07-15T14:00 📅|weekly tomorrow')
    const { from } = dateRefRangeFromDoc(handle.editor)[0]
    // 构建非空选区：from..from+1（键盘插件查找同 dateRefKeydown：按 handleKeyDown 查找）
    handle.editor.commands.setTextSelection({ from, to: from + 1 })
    const plugins = DateRefExtension.config.addProseMirrorPlugins() ?? []
    const plugin = plugins.find(p => typeof p?.spec?.props?.handleKeyDown === 'function')
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

  it('Backspace：单元右侧无内容（行尾）→ 删除整体并连左 pad 一起清，不留悬挂空格', () => {
    handle = createEditor('only @2026-07-15T14:00 📅|weekly')
    const ranges = dateRefRangeFromDoc(handle.editor)
    expect(ranges).toHaveLength(1)
    const r = dateRefKeydown(handle.editor, 'Backspace', ranges[0].to)
    expect(r.handled).toBe(true)
    expect(plainText(handle.editor)).toBe('only')
  })
})

// ─── handleKeyDown：方向键整体跨过单元 ─────────────────────────────────────
// 需求：date-ref 两侧 pad 空格属于单元一部分——→ 在整体左缘带 [L, from] 按 → 跨到
// 整体右缘 R（右 pad 后）；← 在整体右缘带 [to, R] 按 ← 跨回整体左缘 L（左 pad 前）。
// 光标不进入单元与 pad 空格之间。其他位置/带修饰键/带选区 → 放行默认。

describe('DateRefExtension handleKeyDown — 方向键跨过单元', () => {
  let handle: DecoratedEditor
  afterEach(() => {
    handle?.teardown()
  })

  it('ArrowRight：光标在 schedule 单元左缘（from）→ 整体跨过单元到右 pad 后（R）', () => {
    handle = createEditor('meet @2026-07-15T14:00 📅|weekly tomorrow')
    const { from, to } = dateRefRangeFromDoc(handle.editor)[0]
    const r = dateRefKeydown(handle.editor, 'ArrowRight', from)
    expect(r.handled).toBe(true)
    expect(r.preventDefaultCalled).toBe(true)
    expect(handle.editor.state.selection.from).toBe(to + 1) // 跳过右侧 pad 空格
    expect(plainText(handle.editor)).toContain('@2026-07-15T14:00 📅|weekly')
  })

  it('ArrowLeft：光标在 deadline 单元右缘（to）→ 整体跨回左 pad 前（L）', () => {
    handle = createEditor('ship @2026-07-20 ⏰||30 by friday')
    const { from, to } = dateRefRangeFromDoc(handle.editor)[0]
    const r = dateRefKeydown(handle.editor, 'ArrowLeft', to)
    expect(r.handled).toBe(true)
    expect(handle.editor.state.selection.from).toBe(from - 1) // 跳过左侧 pad 空格
  })

  it('ArrowLeft：光标在 ref 单元右缘 → 整体跨回 L', () => {
    handle = createEditor('see @2026-08-03 later')
    const { from, to } = dateRefRangeFromDoc(handle.editor)[0]
    const r = dateRefKeydown(handle.editor, 'ArrowLeft', to)
    expect(r.handled).toBe(true)
    expect(handle.editor.state.selection.from).toBe(from - 1)
  })

  it('ArrowRight：光标在整体左缘（左 pad 前，from-1）→ 同样整体跨到 R', () => {
    handle = createEditor('meet @2026-07-15T14:00 📅|weekly tomorrow')
    const { from, to } = dateRefRangeFromDoc(handle.editor)[0]
    const r = dateRefKeydown(handle.editor, 'ArrowRight', from - 1)
    expect(r.handled).toBe(true)
    expect(handle.editor.state.selection.from).toBe(to + 1)
  })

  it('ArrowLeft：光标站在右 pad 空格上（to+1）→ 整体跨回 L（空格属单元，不逐字移动）', () => {
    handle = createEditor('meet @2026-07-15T14:00 📅|weekly tomorrow')
    const { from, to } = dateRefRangeFromDoc(handle.editor)[0]
    const r = dateRefKeydown(handle.editor, 'ArrowLeft', to + 1)
    expect(r.handled).toBe(true)
    expect(r.preventDefaultCalled).toBe(true)
    expect(handle.editor.state.selection.from).toBe(from - 1)
  })

  it('ArrowRight：光标在普通文本（非单元左缘）→ 不拦截', () => {
    handle = createEditor('meet @2026-07-15T14:00 📅|weekly tomorrow')
    const r = dateRefKeydown(handle.editor, 'ArrowRight', 0) // 段落最前
    expect(r.handled).toBe(false)
    expect(r.preventDefaultCalled).toBe(false)
  })

  it('ArrowLeft：光标在右 pad 之后的普通文本（to+2）→ 不拦截', () => {
    handle = createEditor('meet @2026-07-15T14:00 📅|weekly tomorrow')
    const { to } = dateRefRangeFromDoc(handle.editor)[0]
    const r = dateRefKeydown(handle.editor, 'ArrowLeft', to + 2) // to+1 是 pad 空格（属单元），to+2 已入正文
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
    const plugins = DateRefExtension.config.addProseMirrorPlugins() ?? []
    const plugin = plugins.find(p => typeof p?.spec?.props?.handleKeyDown === 'function')
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
    const plugins = DateRefExtension.config.addProseMirrorPlugins() ?? []
    const plugin = plugins.find(p => typeof p?.spec?.props?.handleKeyDown === 'function')
    const handleKeyDown = plugin?.spec.props.handleKeyDown as ((view: EditorView, event: KeyboardEvent) => boolean) | undefined
    const event = { key: 'ArrowRight', preventDefault: vi.fn() } as unknown as KeyboardEvent
    const handled = handleKeyDown!(handle.editor.view, event)
    expect(handled).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})

// ─── handleDOMEvents.mousedown：守卫 —— chip 点击不落原生光标 ──────────────────
// 编辑态点击 date-ref chip 不应把文本光标插进 chip 内部（chip 是原子单元，落光标会让
// 用户敲坏 `@ISO📅...` 序列化文本）。原生光标在 mousedown 阶段由浏览器落定，
// handleClick 返回 true 不产生 transaction、不会把 DOM 选区同步走，故必须在 mousedown
// 就 cancel 默认行为。本块锁定该守卫。

/** 取 dateRef 装饰插件的 mousedown 守卫 */
function dateRefMousedownHandler(editor: Editor) {
  const plugins = DateRefExtension.config.addProseMirrorPlugins() ?? []
  const plugin = plugins.find(p => typeof p?.spec?.props?.handleDOMEvents?.mousedown === 'function')
  const mousedown = plugin?.spec.props.handleDOMEvents?.mousedown as
    | ((view: EditorView, event: MouseEvent) => boolean)
    | undefined
  expect(mousedown).toBeTypeOf('function')
  return mousedown!
}

describe('DateRefExtension mousedown guard', () => {
  it('chip 目标 → preventDefault（取消原生光标）且返回 false', () => {
    const handle = createEditor('meet @2026-07-15T14:00 📅|weekly tomorrow')
    const span = decoratedSpans(handle.element)[0]
    expect(span).toBeDefined()
    const preventDefault = vi.fn()
    const ret = dateRefMousedownHandler(handle.editor)(
      handle.editor.view,
      { target: span, preventDefault } as unknown as MouseEvent
    )
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(ret).toBe(false)
    handle.teardown()
  })

  it('非 chip 目标 → 不 preventDefault', () => {
    const handle = createEditor('plain text only')
    const plain = document.createElement('span')
    const preventDefault = vi.fn()
    const ret = dateRefMousedownHandler(handle.editor)(
      handle.editor.view,
      { target: plain, preventDefault } as unknown as MouseEvent
    )
    expect(preventDefault).not.toHaveBeenCalled()
    expect(ret).toBe(false)
    handle.teardown()
  })
})
