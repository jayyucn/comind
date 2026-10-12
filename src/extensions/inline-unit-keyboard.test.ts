import { describe, it, expect, vi, afterEach } from 'vitest'
import { Editor, Extension } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { createInlineUnitKeyboardPlugin } from './inline-unit-keyboard'

/**
 * 共享原语的通用契约矩阵（不依赖具体语法）。
 *
 * 测试载体：`@u1` / `@u2` 记号当作「原子单元」，findRanges 现场扫描。
 * 各扩展（date-ref / #tag / [[wiki link]]）只在此之上加「单元怎么找」与
 * 「菜单态放行」，语法差异由各自的扩展测试覆盖。
 */

interface UnitEditor {
  editor: Editor
  element: HTMLElement
  teardown: () => void
}

let blockFlag = false

/** 扫描 `@u\d+` 单元区间（模拟宿主扩展的同源扫描） */
function scanTestUnits(doc: Node): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = []
  doc.descendants((node, pos) => {
    if (!node.isText) return
    const text = node.text || ''
    const re = /@u\d+/g
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      ranges.push({ from: pos + m.index, to: pos + m.index + m[0].length })
    }
  })
  return ranges
}

const TestUnitExtension = Extension.create({
  name: 'testUnit',
  addProseMirrorPlugins() {
    return [
      createInlineUnitKeyboardPlugin({
        key: 'testUnitKeyboard',
        findRanges: scanTestUnits,
        isBlocked: () => blockFlag,
      }),
    ]
  },
})

function createEditor(content: string): UnitEditor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({
    element,
    extensions: [Document, Paragraph, Text, TestUnitExtension],
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

function unitRanges(editor: Editor): { from: number; to: number }[] {
  return scanTestUnits(editor.state.doc)
}

/** 取共享原语的 handleKeyDown（真实 view 驱动）；selection 显式传入时按其设置（非空选区场景） */
function unitKeydown(
  editor: Editor,
  key: string,
  pos: number,
  extra: Record<string, unknown> = {},
  selection?: { from: number; to: number }
) {
  const plugins = TestUnitExtension.config.addProseMirrorPlugins() ?? []
  const plugin = plugins.find(p => typeof p?.spec?.props?.handleKeyDown === 'function')
  const handleKeyDown = plugin?.spec.props.handleKeyDown as
    | ((view: EditorView, event: KeyboardEvent) => boolean)
    | undefined
  expect(handleKeyDown).toBeTypeOf('function')
  if (selection) {
    editor.commands.setTextSelection(selection)
  } else {
    editor.commands.setTextSelection(pos)
  }
  const preventDefault = vi.fn()
  const event = { key, preventDefault, ...extra } as unknown as KeyboardEvent
  const handled = handleKeyDown!(editor.view, event)
  return { handled, preventDefaultCalled: preventDefault.mock.calls.length > 0 }
}

function plainText(editor: Editor) {
  return editor.state.doc.textContent
}

describe('inline-unit-keyboard — Backspace 整单元删除（右缘带）', () => {
  let handle: UnitEditor
  afterEach(() => {
    handle?.teardown()
    blockFlag = false
  })

  it('光标精确位于单元右侧 → 删除整体（单元+两侧 pad 空格），保留单空格分隔', () => {
    handle = createEditor('meet @u1 tomorrow')
    const { to } = unitRanges(handle.editor)[0]
    const r = unitKeydown(handle.editor, 'Backspace', to)
    expect(r.handled).toBe(true)
    expect(r.preventDefaultCalled).toBe(true)
    expect(plainText(handle.editor)).toBe('meet tomorrow')
  })

  it('光标站在右 pad 空格上（to+1）→ 删除整个整体（空格属单元，不留悬挂）', () => {
    handle = createEditor('meet @u1 tomorrow')
    const { to } = unitRanges(handle.editor)[0]
    const r = unitKeydown(handle.editor, 'Backspace', to + 1)
    expect(r.handled).toBe(true)
    expect(plainText(handle.editor)).toBe('meet tomorrow')
  })

  it('行尾单元带尾 pad（doc 末尾）→ 整体删除连左 pad 一起清，不留悬挂空格', () => {
    handle = createEditor('only @u1 ')
    const { to } = unitRanges(handle.editor)[0]
    const r = unitKeydown(handle.editor, 'Backspace', to)
    expect(r.handled).toBe(true)
    expect(plainText(handle.editor)).toBe('only')
  })

  it('行尾单元无尾 pad（单元即块尾）→ 整体删除', () => {
    handle = createEditor('only @u1')
    const { to } = unitRanges(handle.editor)[0]
    const r = unitKeydown(handle.editor, 'Backspace', to)
    expect(r.handled).toBe(true)
    expect(plainText(handle.editor)).toBe('only')
  })

  it('光标在单元内部 → 不整删（返回 false，走正常逐字符删除）', () => {
    handle = createEditor('meet @u1 tomorrow')
    const { from } = unitRanges(handle.editor)[0]
    const r = unitKeydown(handle.editor, 'Backspace', from + 1)
    expect(r.handled).toBe(false)
    expect(r.preventDefaultCalled).toBe(false)
    expect(plainText(handle.editor)).toBe('meet @u1 tomorrow')
  })

  it('光标在单元左侧（from-1）→ 不整删，正常删除左侧字符', () => {
    handle = createEditor('meet @u1 tomorrow')
    const { from } = unitRanges(handle.editor)[0]
    const r = unitKeydown(handle.editor, 'Backspace', from - 1)
    expect(r.handled).toBe(false)
    expect(r.preventDefaultCalled).toBe(false)
  })

  it('光标在普通文本处 → 不拦截（返回 false）', () => {
    handle = createEditor('meet @u1 tomorrow')
    const r = unitKeydown(handle.editor, 'Backspace', 0)
    expect(r.handled).toBe(false)
    expect(r.preventDefaultCalled).toBe(false)
  })

  it('多单元：光标在第一个单元右侧 → 只删第一个整体，保留第二个', () => {
    handle = createEditor('@u1 与 @u2')
    const ranges = unitRanges(handle.editor)
    expect(ranges).toHaveLength(2)
    const r = unitKeydown(handle.editor, 'Backspace', ranges[0].to)
    expect(r.handled).toBe(true)
    expect(plainText(handle.editor)).toBe('与 @u2')
  })

  it('单元右侧紧跟文本（无 pad）→ 只删单元，保留后续文本', () => {
    handle = createEditor('go @u1,then continue')
    const { to } = unitRanges(handle.editor)[0]
    const r = unitKeydown(handle.editor, 'Backspace', to)
    expect(r.handled).toBe(true)
    expect(plainText(handle.editor)).toBe('go ,then continue')
  })

  it('有选区（非 collapsed）→ 不拦截（交给默认选区删除）', () => {
    handle = createEditor('meet @u1 tomorrow')
    const { from } = unitRanges(handle.editor)[0]
    const r = unitKeydown(handle.editor, 'Backspace', from, {}, { from, to: from + 1 })
    expect(r.handled).toBe(false)
    expect(r.preventDefaultCalled).toBe(false)
    expect(plainText(handle.editor)).toContain('@u1')
  })

  it('isBlocked 为真（补全菜单打开中）→ 不拦截，走逐字符', () => {
    blockFlag = true
    handle = createEditor('meet @u1 tomorrow')
    const { to } = unitRanges(handle.editor)[0]
    const r = unitKeydown(handle.editor, 'Backspace', to)
    expect(r.handled).toBe(false)
    expect(r.preventDefaultCalled).toBe(false)
    expect(plainText(handle.editor)).toBe('meet @u1 tomorrow')
  })

  it('IME 组合中（keyCode 229）→ 不拦截', () => {
    handle = createEditor('meet @u1 tomorrow')
    const { to } = unitRanges(handle.editor)[0]
    const r = unitKeydown(handle.editor, 'Backspace', to, { isComposing: true, keyCode: 229 })
    expect(r.handled).toBe(false)
    expect(r.preventDefaultCalled).toBe(false)
  })
})

describe('inline-unit-keyboard — Delete 整单元删除（左缘带，镜像）', () => {
  let handle: UnitEditor
  afterEach(() => {
    handle?.teardown()
    blockFlag = false
  })

  it('光标在单元左侧 → 删除整个整体（保持镜像语义）', () => {
    handle = createEditor('meet @u1 tomorrow')
    const { from } = unitRanges(handle.editor)[0]
    const r = unitKeydown(handle.editor, 'Delete', from)
    expect(r.handled).toBe(true)
    expect(plainText(handle.editor)).toBe('meet tomorrow')
  })

  it('光标站在左 pad 空格上（from-1）→ 同样删除整个整体', () => {
    handle = createEditor('meet @u1 tomorrow')
    const { from } = unitRanges(handle.editor)[0]
    const r = unitKeydown(handle.editor, 'Delete', from - 1)
    expect(r.handled).toBe(true)
    expect(plainText(handle.editor)).toBe('meet tomorrow')
  })

  it('Delete 在单元右侧（Backspace 缘带）→ 不拦截（左右不串）', () => {
    handle = createEditor('meet @u1 tomorrow')
    const { to } = unitRanges(handle.editor)[0]
    const r = unitKeydown(handle.editor, 'Delete', to)
    expect(r.handled).toBe(false)
    expect(r.preventDefaultCalled).toBe(false)
  })
})

describe('inline-unit-keyboard — 方向键整体跨过单元', () => {
  let handle: UnitEditor
  afterEach(() => {
    handle?.teardown()
    blockFlag = false
  })

  it('ArrowRight：光标在单元左缘（from）→ 整体跨过单元到右 pad 后（R）', () => {
    handle = createEditor('meet @u1 tomorrow')
    const { from, to } = unitRanges(handle.editor)[0]
    const r = unitKeydown(handle.editor, 'ArrowRight', from)
    expect(r.handled).toBe(true)
    expect(r.preventDefaultCalled).toBe(true)
    expect(handle.editor.state.selection.from).toBe(to + 1)
    expect(plainText(handle.editor)).toContain('@u1')
  })

  it('ArrowLeft：光标在单元右缘（to）→ 整体跨回左 pad 前（L）', () => {
    handle = createEditor('meet @u1 tomorrow')
    const { from, to } = unitRanges(handle.editor)[0]
    const r = unitKeydown(handle.editor, 'ArrowLeft', to)
    expect(r.handled).toBe(true)
    expect(handle.editor.state.selection.from).toBe(from - 1)
  })

  it('ArrowRight：光标站在左 pad 上（from-1）→ 同样整体跨到 R', () => {
    handle = createEditor('meet @u1 tomorrow')
    const { from, to } = unitRanges(handle.editor)[0]
    const r = unitKeydown(handle.editor, 'ArrowRight', from - 1)
    expect(r.handled).toBe(true)
    expect(handle.editor.state.selection.from).toBe(to + 1)
  })

  it('ArrowLeft：光标站在右 pad 空格上（to+1）→ 整体跨回 L（空格属单元，不逐字移动）', () => {
    handle = createEditor('meet @u1 tomorrow')
    const { from, to } = unitRanges(handle.editor)[0]
    const r = unitKeydown(handle.editor, 'ArrowLeft', to + 1)
    expect(r.handled).toBe(true)
    expect(r.preventDefaultCalled).toBe(true)
    expect(handle.editor.state.selection.from).toBe(from - 1)
  })

  it('ArrowLeft：光标在右 pad 之后的普通文本（to+2）→ 不拦截', () => {
    handle = createEditor('meet @u1 tomorrow')
    const { to } = unitRanges(handle.editor)[0]
    const r = unitKeydown(handle.editor, 'ArrowLeft', to + 2)
    expect(r.handled).toBe(false)
    expect(r.preventDefaultCalled).toBe(false)
  })

  it('ArrowRight：光标在普通文本（非单元左缘）→ 不拦截', () => {
    handle = createEditor('meet @u1 tomorrow')
    const r = unitKeydown(handle.editor, 'ArrowRight', 0)
    expect(r.handled).toBe(false)
    expect(r.preventDefaultCalled).toBe(false)
  })

  it('相邻单元夹缝：ArrowLeft 跨过左侧单元、ArrowRight 跨过右侧单元', () => {
    handle = createEditor('@u1@u2')
    const [a, b] = unitRanges(handle.editor)
    expect(a.to).toBe(b.from)
    const rLeft = unitKeydown(handle.editor, 'ArrowLeft', a.to)
    expect(rLeft.handled).toBe(true)
    expect(handle.editor.state.selection.from).toBe(a.from)
    const rRight = unitKeydown(handle.editor, 'ArrowRight', b.from)
    expect(rRight.handled).toBe(true)
    expect(handle.editor.state.selection.from).toBe(b.to)
  })

  it('ctrl+ArrowRight 在单元左缘 → 不拦截（交给默认整词移动）', () => {
    handle = createEditor('meet @u1 tomorrow')
    const { from } = unitRanges(handle.editor)[0]
    const r = unitKeydown(handle.editor, 'ArrowRight', from, { ctrlKey: true })
    expect(r.handled).toBe(false)
    expect(r.preventDefaultCalled).toBe(false)
  })

  it('shift+ArrowLeft 在单元右缘 → 不拦截（交给默认选区扩展）', () => {
    handle = createEditor('meet @u1 tomorrow')
    const { to } = unitRanges(handle.editor)[0]
    const r = unitKeydown(handle.editor, 'ArrowLeft', to, { shiftKey: true })
    expect(r.handled).toBe(false)
    expect(r.preventDefaultCalled).toBe(false)
  })

  it('ArrowRight 带选区（非 collapsed）在单元左缘 → 不拦截（交给默认选区扩展）', () => {
    handle = createEditor('meet @u1 tomorrow')
    const { from } = unitRanges(handle.editor)[0]
    const r = unitKeydown(handle.editor, 'ArrowRight', from, {}, { from, to: from + 1 })
    expect(r.handled).toBe(false)
    expect(r.preventDefaultCalled).toBe(false)
  })

  it('isBlocked 为真（补全菜单打开中）→ 方向键同样放行', () => {
    blockFlag = true
    handle = createEditor('meet @u1 tomorrow')
    const { from } = unitRanges(handle.editor)[0]
    const r = unitKeydown(handle.editor, 'ArrowRight', from)
    expect(r.handled).toBe(false)
    expect(r.preventDefaultCalled).toBe(false)
  })

  it('ArrowUp / ArrowDown 永不归此原语管（跨块列保持归 EnterAsBlock）', () => {
    handle = createEditor('meet @u1 tomorrow')
    const { from } = unitRanges(handle.editor)[0]
    const rUp = unitKeydown(handle.editor, 'ArrowUp', from)
    expect(rUp.handled).toBe(false)
    const rDown = unitKeydown(handle.editor, 'ArrowDown', from)
    expect(rDown.handled).toBe(false)
  })
})

describe('inline-unit-keyboard — 无单元场景', () => {
  let handle: UnitEditor
  afterEach(() => {
    handle?.teardown()
    blockFlag = false
  })

  it('纯文本块：Backspace / 方向键均不拦截', () => {
    handle = createEditor('plain text no unit')
    expect(unitRanges(handle.editor)).toHaveLength(0)
    const rBs = unitKeydown(handle.editor, 'Backspace', 5)
    expect(rBs.handled).toBe(false)
    const rArrow = unitKeydown(handle.editor, 'ArrowRight', 5)
    expect(rArrow.handled).toBe(false)
  })
})
