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

/** 取共享原语的 handleKeyDown（真实 view 驱动）；selection 显式传入时按其设置（非空选区场景），
 *  pos 为 null 时沿用当前选区（建造事务落下的内部光标，经 setTextSelection 会被闸门钳回） */
function unitKeydown(
  editor: Editor,
  key: string,
  pos: number | null,
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
  } else if (pos !== null) {
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
    const { from, to } = unitRanges(handle.editor)[0]
    // 闸门口径下纯选区事务进不了单元内部，光标只能经建造事务（打字）入内：
    // 在 'u' 后插入 '2' → '@u21'（仍匹配），光标落在内部 from+3
    handle.editor.commands.insertContentAt(from + 2, '2')
    expect(handle.editor.state.selection.from).toBe(from + 3)
    expect(unitRanges(handle.editor)[0]).toMatchObject({ from, to: from + 4 })
    const r = unitKeydown(handle.editor, 'Backspace', null)
    expect(r.handled).toBe(false)
    expect(r.preventDefaultCalled).toBe(false)
    expect(plainText(handle.editor)).toBe('meet @u21 tomorrow')
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

/**
 * 选择闸门（appendTransaction）契约矩阵：光标/选区永不入单元内部。
 *
 * 覆盖入口：点击与拖拽（PM 以纯选区事务落定）、双击原生词选（经 selectionchange
 * 同步回 PM）、Shift+方向键选区扩展、程序化 setTextSelection。改文档事务
 * （打字/IME/粘贴）放行 —— 单元建造需要内部光标。
 * 测试以真实 dispatch 驱动（appendTransaction 随事务自动运行），不走 prop 直调。
 */
describe('inline-unit-keyboard — 选择闸门（光标/选区不入单元内部）', () => {
  let handle: UnitEditor
  afterEach(() => {
    handle?.teardown()
    blockFlag = false
  })

  it('光标落入单元内部（点击/拖拽落点）→ 钳到近端边界', () => {
    handle = createEditor('meet @u1 tomorrow')
    const { from, to } = unitRanges(handle.editor)[0]
    // from+1 距左缘 1 字符、距右缘 2 字符 → 近端是 from
    handle.editor.commands.setTextSelection(from + 1)
    expect(handle.editor.state.selection.from).toBe(from)
    // to-1 距右缘 1 字符 → 近端是 to
    handle.editor.commands.setTextSelection(to - 1)
    expect(handle.editor.state.selection.from).toBe(to)
  })

  it('光标在单元边界（from / to）→ 不钳（缘带属合法站位）', () => {
    handle = createEditor('meet @u1 tomorrow')
    const { from, to } = unitRanges(handle.editor)[0]
    handle.editor.commands.setTextSelection(from)
    expect(handle.editor.state.selection.from).toBe(from)
    handle.editor.commands.setTextSelection(to)
    expect(handle.editor.state.selection.from).toBe(to)
  })

  it('shift+→ 选区扩展头部进入单元 → head 吸附到远端边界 to（整体吞掉单元，不卡左缘）', () => {
    handle = createEditor('meet @u1 tomorrow')
    const { from, to } = unitRanges(handle.editor)[0]
    handle.editor.commands.setTextSelection({ from: from - 1, to: from + 1 })
    const sel = handle.editor.state.selection
    expect(sel.anchor).toBe(from - 1)
    expect(sel.head).toBe(to)
  })

  it('shift+← 镜像：head 自右进入单元 → 吸附到 from', () => {
    handle = createEditor('meet @u1 tomorrow')
    const { from, to } = unitRanges(handle.editor)[0]
    handle.editor.commands.setTextSelection({ from: to + 1, to: to - 1 })
    const sel = handle.editor.state.selection
    expect(sel.anchor).toBe(to + 1)
    expect(sel.head).toBe(from)
  })

  it('双击原生词选（anchor/head 均在单元内部）→ 钳成整单元选区', () => {
    handle = createEditor('meet @u1 tomorrow')
    const { from, to } = unitRanges(handle.editor)[0]
    handle.editor.commands.setTextSelection({ from: from + 1, to: to - 1 })
    const sel = handle.editor.state.selection
    expect(sel.from).toBe(from)
    expect(sel.to).toBe(to)
  })

  it('打字事务放行：insertContentAt 落在单元内部 → 光标不被钳（单元建造中）', () => {
    handle = createEditor('go @u123 now')
    const { from, to } = unitRanges(handle.editor)[0]
    expect(handle.editor.state.doc.textBetween(from, to)).toBe('@u123')
    // 在 '1' 与 '2' 之间插入 '4'：单元文本长成 '@u1423'（仍匹配），光标停在插入内容之后（内部）
    handle.editor.commands.insertContentAt(from + 3, '4')
    const sel = handle.editor.state.selection
    // '@u1423' 长度 6 → 新单元区间 [from, from+6)；光标 from+4 在其内部且未被钳
    expect(handle.editor.state.doc.textBetween(from, from + 6)).toBe('@u1423')
    expect(sel.from).toBe(from + 4)
    expect(sel.from).toBeGreaterThan(from)
    expect(sel.from).toBeLessThan(from + 6)
  })

  it('isBlocked 为真（补全菜单打开中）→ 闸门不钳', () => {
    blockFlag = true
    handle = createEditor('meet @u1 tomorrow')
    const { from } = unitRanges(handle.editor)[0]
    handle.editor.commands.setTextSelection(from + 1)
    expect(handle.editor.state.selection.from).toBe(from + 1)
  })
})

/**
 * 删除黏连（doc 变更事务落点钳制）：选中 chip 后 pad 空格删除，贪婪单元
 * （tag 正则吸字母数字）与后续文本黏连扩展，删除落点坠入扩展后的单元内部。
 * 闸门对「纯删除」事务（ReplaceStep from<to 且 slice 空）钳落点；
 * 纯插入（打字/粘贴）与替换（IME 确认）放行 —— 建造流需要内部光标。
 */
describe('inline-unit-keyboard — 删除黏连（纯删除事务落点钳制）', () => {
  let handle: UnitEditor

  /** 贪婪扫描（模拟 tag 正则的字母数字贪婪扩展）：`@u1next` 整段算单元 */
  function scanGreedyUnits(doc: Node): { from: number; to: number }[] {
    const ranges: { from: number; to: number }[] = []
    doc.descendants((node, pos) => {
      if (!node.isText) return
      const re = /@u[\w]+/g
      let m: RegExpExecArray | null
      while ((m = re.exec(node.text || '')) !== null) {
        ranges.push({ from: pos + m.index, to: pos + m.index + m[0].length })
      }
    })
    return ranges
  }

  const GreedyUnitExtension = Extension.create({
    name: 'greedyUnit',
    addProseMirrorPlugins() {
      return [
        createInlineUnitKeyboardPlugin({
          key: 'greedyUnitKeyboard',
          findRanges: scanGreedyUnits,
        }),
      ]
    },
  })

  function createGreedyEditor(content: string): UnitEditor {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const editor = new Editor({
      element,
      extensions: [Document, Paragraph, Text, GreedyUnitExtension],
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

  afterEach(() => {
    handle?.teardown()
  })

  it('选中右 pad 空格删除 → 单元黏连扩展，光标钳出扩展单元内部', () => {
    handle = createGreedyEditor('x @u1 next')
    const { from, to } = scanGreedyUnits(handle.editor.state.doc)[0]
    // shift+→ 从右缘选中 pad 空格，Backspace 删除选区（纯删除事务）
    handle.editor.commands.setTextSelection({ from: to, to: to + 1 })
    handle.editor.commands.deleteSelection()
    const sel = handle.editor.state.selection
    const ranges = scanGreedyUnits(handle.editor.state.doc)
    // 单元黏连扩展为 @u1next
    expect(ranges[0]).toMatchObject({ from, to: to + 4 })
    // 光标不在扩展单元内部（钳到边界）
    expect(sel.from > ranges[0].from && sel.from < ranges[0].to).toBe(false)
  })

  it('等距平局取右缘：删除后光标贴扩展单元右缘（右 pad 语义延续）', () => {
    // '@u12'(4 字符) 删 pad 黏连 'next'(4 字符) → 光标距两端等距
    handle = createGreedyEditor('x @u12 next')
    const { to } = scanGreedyUnits(handle.editor.state.doc)[0]
    handle.editor.commands.setTextSelection({ from: to, to: to + 1 })
    handle.editor.commands.deleteSelection()
    const ranges = scanGreedyUnits(handle.editor.state.doc)
    expect(handle.editor.state.doc.textBetween(ranges[0].from, ranges[0].to)).toBe('@u12next')
    expect(handle.editor.state.selection.from).toBe(ranges[0].to)
  })

  it('封闭单元（@u\\d+）删 pad 单元不变 → 落点即右缘，不钳', () => {
    handle = createEditor('meet @u1 tomorrow')
    const { to } = unitRanges(handle.editor)[0]
    handle.editor.commands.setTextSelection({ from: to, to: to + 1 })
    handle.editor.commands.deleteSelection()
    expect(handle.editor.state.doc.textContent).toBe('meet @u1tomorrow')
    expect(handle.editor.state.selection.from).toBe(to)
  })

  it('IME 组合中（compositionstart 后）删除放行 → 建造光标不被钳', () => {
    handle = createGreedyEditor('x @u1 next')
    const { to } = scanGreedyUnits(handle.editor.state.doc)[0]
    // 从 view.state.plugins 取实际注册的插件实例（同闭包 epoch），
    // 直调 handleDOMEvents 模拟组合开始（组合内删除属单元文本建造）
    const plugin = handle.editor.view.state.plugins.find(
      p => typeof p?.spec?.props?.handleDOMEvents?.compositionstart === 'function',
    )
    const onStart = plugin?.spec.props.handleDOMEvents?.compositionstart as () => boolean
    expect(onStart).toBeTypeOf('function')
    onStart()
    handle.editor.commands.setTextSelection({ from: to, to: to + 1 })
    handle.editor.commands.deleteSelection()
    const ranges = scanGreedyUnits(handle.editor.state.doc)
    expect(ranges[0]).toMatchObject({ to: to + 4 })
    // 组合中不钳：光标留在删除落点（扩展单元内部）
    expect(handle.editor.state.selection.from > ranges[0].from).toBe(true)
    expect(handle.editor.state.selection.from < ranges[0].to).toBe(true)
  })
})

/**
 * 块尾光标锚点（decorations）：单元右缘恰为文本块内容末尾时，浏览器
 * contentEditable 会把块尾光标吸进最后一个 inline chip 内部（视觉穿帮）——
 * 拖拽 / shift+← 选中尾部 pad 空格删除后即触发。共享原语在 to 处放零宽
 * widget 作 chip 外光标锚点；非块尾不挂。
 */
describe('inline-unit-keyboard — 块尾光标锚点（零宽 widget）', () => {
  let handle: UnitEditor
  afterEach(() => {
    handle?.teardown()
  })

  /** view.dom 内渲染出的零宽锚点 span 数量 */
  function anchorCount(editor: Editor): number {
    let n = 0
    editor.view.dom.querySelectorAll('span').forEach((s) => {
      if (s.textContent === '\u200b') n++
    })
    return n
  }

  /** PM JSON 构造（HTML content 会丢尾随空格，pad 场景必须走 JSON） */
  function createTextEditor(text: string): UnitEditor {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const editor = new Editor({
      element,
      extensions: [Document, Paragraph, Text, TestUnitExtension],
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      },
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

  it('单元即块尾（无尾随字符）→ to 处挂零宽 widget', () => {
    handle = createTextEditor('only @u1')
    expect(unitRanges(handle.editor)[0].to).toBe(handle.editor.state.doc.content.size - 1)
    expect(anchorCount(handle.editor)).toBe(1)
  })

  it('单元后有尾随字符（含 pad 空格）→ 不挂 widget', () => {
    handle = createTextEditor('meet @u1 tomorrow')
    expect(anchorCount(handle.editor)).toBe(0)
    handle.teardown()

    handle = createTextEditor('meet @u1 ')
    expect(anchorCount(handle.editor)).toBe(0)
  })

  it('删除块尾 pad 后 → widget 动态出现（光标锚定 chip 外）', () => {
    handle = createTextEditor('meet @u1 ')
    expect(anchorCount(handle.editor)).toBe(0)
    const { to } = unitRanges(handle.editor)[0]
    handle.editor.commands.setTextSelection({ from: to, to: to + 1 })
    handle.editor.commands.deleteSelection()
    // 删除后单元右缘成块尾 → widget 出现；光标逻辑位置仍在 to（未入内部）
    expect(handle.editor.state.doc.textContent).toBe('meet @u1')
    expect(anchorCount(handle.editor)).toBe(1)
    expect(handle.editor.state.selection.from).toBe(to)
  })

  it('删除块尾 pad 后光标锚点落在 chip 外（domFromPos 不坠入 chip 文本）', () => {
    handle = createTextEditor('meet @u1 ')
    const { to } = unitRanges(handle.editor)[0]
    handle.editor.commands.setTextSelection({ from: to, to: to + 1 })
    handle.editor.commands.deleteSelection()
    // setSelection 对折叠光标调用 domFromPos(to, -1)（左偏）。side:1（旧）会回退进
    // chip 文本节点末尾（光标在 chip 内部）；side:-1（修复后）解析到段落末位子节点
    // 之后（chip 之外）。
    const box = (handle.editor.view as unknown as { docView: { domFromPos(p: number, s: number): { node: Node; offset: number } } })
      .docView.domFromPos(to, -1)
    // 元素节点（P）= chip 外；文本节点（nodeType 3）= chip 文本内部（回归）
    expect(box.node.nodeType).toBe(1)
    expect((box.node as HTMLElement).nodeName).toBe('P')
    // 删除尾 pad 后整块仍只剩 chip，逻辑光标仍在 to（未入内部）
    expect(handle.editor.state.selection.from).toBe(to)
  })

  it('拖拽部分选中 chip 后删除 → 删除事务层兜底，整 chip 被删（不留半截）', () => {
    handle = createTextEditor('@u1')
    expect(unitRanges(handle.editor).length).toBe(1)
    const { state, dispatch } = handle.editor.view
    // 模拟「拖拽选中 chip 内部部分文本并删除」：删除事务直接吃 chip 中一段，
    // 不经选区吸附闸门（拖拽路径实际表现）。旧逻辑会留下半截（"@1"），
    // 新逻辑在删除事务层兜底 → 整 chip 删除。
    dispatch(state.tr.delete(2, 3)) // 删 "u"，原会留下 "@1"
    expect(handle.editor.state.doc.textContent).toBe('') // 整 chip 删除
    expect(unitRanges(handle.editor).length).toBe(0)
  })

  it('删除事务仅擦到 chip 边缘、未真正重叠 → 不误阔', () => {
    handle = createTextEditor('@u1 x')
    const { state, dispatch } = handle.editor.view
    // 删除 " x"（chip 之后、不重叠 chip 区间 [1,4)）→ chip 完整保留
    dispatch(state.tr.delete(4, 6))
    expect(handle.editor.state.doc.textContent).toBe('@u1')
    expect(unitRanges(handle.editor).length).toBe(1)
  })
})
