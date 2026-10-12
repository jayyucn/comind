import { describe, it, expect, vi, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import type { EditorView } from '@tiptap/pm/view'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { InlineTagExtension } from './InlineTagExtension'
import { InlineTagTriggerExtension, isTagMenuOpen, closeTagMenuByEditor } from './InlineTagTriggerExtension'
import { TAG_TRIGGER_SOURCE } from '../composables/useContentRenderer'

interface DecoratedEditor {
  editor: Editor
  element: HTMLElement
  renderedHTML: string
}

// resolver 闭包读这张可变表，模拟宿主（Editor.vue）注入的 reactive 闭包
let tagTable: Record<string, { color: string; is_system: boolean }> = {}

function createDecoratedEditor(content: string): DecoratedEditor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({
    element,
    extensions: [
      Document,
      Paragraph,
      Text,
      InlineTagExtension.configure({
        resolve: (title) => tagTable[title],
      }),
    ],
    content: `<p>${content}</p>`,
  })
  return { editor, element, renderedHTML: element.innerHTML }
}

function destroyDecoratedEditor(handle: DecoratedEditor): void {
  handle.editor.destroy()
  handle.element.remove()
}

describe('InlineTagExtension — 编辑态 `#tag` 胶囊（与渲染态同形，ADR-0050 D11）', () => {
  it('`#tag` 整段装饰为 block-tag，tag 名取 resolver 给的色', () => {
    tagTable = { 标签: { color: '--tag-color-3', is_system: false } }
    const handle = createDecoratedEditor('这是 #标签')
    expect(handle.renderedHTML).toContain('block-tag')
    // jsdom 会把 style 属性归一化（`color:var(...)` → `color: var(...);`），用宽松匹配
    expect(handle.renderedHTML).toMatch(/style="[^"]*color:\s*var\(--tag-color-3\)/)
    expect(handle.renderedHTML).toContain('--tag-color-3')
    destroyDecoratedEditor(handle)
  })

  it('装饰不改变文档内容（`#` 按字面保留，光标/选区偏移不受影响）', () => {
    tagTable = {}
    const handle = createDecoratedEditor('#标签 后面')
    expect(handle.element.textContent).toBe('#标签 后面')
    expect(handle.editor.getText()).toBe('#标签 后面')
    destroyDecoratedEditor(handle)
  })

  it('查无此 tag：只有类名、无内联样式 —— 落回 .block-tag 的默认色', () => {
    tagTable = {}
    const handle = createDecoratedEditor('这是 #标签')
    expect(handle.renderedHTML).toContain('block-tag')
    expect(handle.renderedHTML).not.toContain('style=')
    destroyDecoratedEditor(handle)
  })

  it('系统 tag 带 block-tag--system 修饰类', () => {
    tagTable = { 任务: { color: '', is_system: true } }
    const handle = createDecoratedEditor('#任务')
    expect(handle.renderedHTML).toContain('block-tag--system')
    expect(handle.renderedHTML).not.toContain('style=')
    destroyDecoratedEditor(handle)
  })

  it('未白名单的色值不进 DOM（tagChipStyle 白名单收口）', () => {
    tagTable = { 标签: { color: 'red;}</style><img src=x onerror=alert(1)>', is_system: false } }
    const handle = createDecoratedEditor('#标签')
    expect(handle.renderedHTML).not.toContain('style=')
    expect(handle.renderedHTML).not.toContain('<img')
    destroyDecoratedEditor(handle)
  })

  it('非 tag 文本不产生装饰', () => {
    tagTable = {}
    const handle = createDecoratedEditor('纯文本 没有井号')
    expect(handle.renderedHTML).not.toContain('block-tag')
    destroyDecoratedEditor(handle)
  })

  it('多个 tag 各自装饰', () => {
    tagTable = {
      一: { color: '--tag-color-2', is_system: false },
      二: { color: '--tag-color-4', is_system: false },
    }
    const handle = createDecoratedEditor('#一 和 #二')
    const count = (handle.renderedHTML.match(/block-tag/g) ?? []).length
    expect(count).toBe(2)
    destroyDecoratedEditor(handle)
  })

  it('resolver 闭包更新后，空 transaction 触发装饰重算（宿主 watch 的接法）', () => {
    tagTable = {}
    const handle = createDecoratedEditor('这是 #标签')
    expect(handle.renderedHTML).not.toContain('style=')
    // 标签树异步到位：宿主改表后 dispatch 空 tr 逼一次 view update 重算装饰
    tagTable = { 标签: { color: '--tag-color-5', is_system: false } }
    handle.editor.view.dispatch(handle.editor.state.tr)
    expect(handle.element.innerHTML).toMatch(/color:\s*var\(--tag-color-5\)/)
    destroyDecoratedEditor(handle)
  })
})

// ─── 键盘原子语义（共享原语 inline-unit-keyboard 接线） ─────────────────────
// 通用契约矩阵（pad 语义 / 缘带 / 修饰键 / 选区 / IME）由
// inline-unit-keyboard.test.ts 钉死；本块只验 tag 语法侧接线：
// 单元范围 = 装饰范围（同源扫描）、菜单打开中放行。

/** 与扩展同源的 tag 区间扫描（TAG_TRIGGER_SOURCE 是唯一事实来源） */
function tagRanges(editor: Editor): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = []
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return
    const text = node.text || ''
    const re = new RegExp(TAG_TRIGGER_SOURCE, 'gu')
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      ranges.push({ from: pos + m.index, to: pos + m.index + m[0].length })
    }
  })
  return ranges
}

/** 驱动真实 view 上挂载的 inlineTagKeyboard 插件 handleKeyDown（TipTap 会给插件 key 加 `$` 后缀，用前缀匹配） */
function tagKeydown(editor: Editor, key: string, pos: number) {
  const plugin = editor.state.plugins.find(p => p.key.startsWith('inlineTagKeyboard'))
  expect(plugin, 'inlineTagKeyboard 插件未挂载').toBeDefined()
  const handleKeyDown = plugin!.spec.props.handleKeyDown as
    | ((view: EditorView, event: KeyboardEvent) => boolean)
    | undefined
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

describe('InlineTagExtension — 键盘原子语义（共享原语接线）', () => {
  afterEach(() => {
    closeTagMenuByEditor()
  })

  it('键盘单元与装饰同源：tag 区间数 = block-tag 装饰 span 数', () => {
    tagTable = { 标签: { color: '--tag-color-3', is_system: false } }
    const handle = createDecoratedEditor('任务 #标签 完成')
    const spans = handle.element.querySelectorAll('span.block-tag')
    expect(spans).toHaveLength(1)
    expect(tagRanges(handle.editor)).toHaveLength(1)
    // 装饰 span 文本即整个 #tag（含 # 字面字符）
    expect(spans[0].textContent).toBe('#标签')
    destroyDecoratedEditor(handle)
  })

  it('Backspace：光标在 tag 右缘 → 整删 #标签（含右邻空格，保留左空格分隔）', () => {
    tagTable = {}
    const handle = createDecoratedEditor('任务 #标签 完成')
    const { to } = tagRanges(handle.editor)[0]
    const r = tagKeydown(handle.editor, 'Backspace', to)
    expect(r.handled).toBe(true)
    expect(r.preventDefaultCalled).toBe(true)
    expect(plainText(handle.editor)).toBe('任务 完成')
    destroyDecoratedEditor(handle)
  })

  it('Backspace：光标站在右 pad 空格上（to+1）→ 整删（空格属单元，不留悬挂）', () => {
    tagTable = {}
    const handle = createDecoratedEditor('任务 #标签 完成')
    const { to } = tagRanges(handle.editor)[0]
    const r = tagKeydown(handle.editor, 'Backspace', to + 1)
    expect(r.handled).toBe(true)
    expect(plainText(handle.editor)).toBe('任务 完成')
    destroyDecoratedEditor(handle)
  })

  it('Backspace：tag 在行尾 → 整删并清左 pad，不留悬挂空格', () => {
    tagTable = {}
    const handle = createDecoratedEditor('只有 #标签')
    const { to } = tagRanges(handle.editor)[0]
    const r = tagKeydown(handle.editor, 'Backspace', to)
    expect(r.handled).toBe(true)
    expect(plainText(handle.editor)).toBe('只有')
    destroyDecoratedEditor(handle)
  })

  it('Backspace：多 tag（#一 #二）光标在第一个右缘 → 只删第一个整体', () => {
    tagTable = {}
    const handle = createDecoratedEditor('#一 #二')
    const ranges = tagRanges(handle.editor)
    expect(ranges).toHaveLength(2)
    const r = tagKeydown(handle.editor, 'Backspace', ranges[0].to)
    expect(r.handled).toBe(true)
    expect(plainText(handle.editor)).toBe('#二')
    destroyDecoratedEditor(handle)
  })

  it('Backspace：相邻无空格 #一#二 夹缝 → 只删第一个，第二个完整保留', () => {
    tagTable = {}
    const handle = createDecoratedEditor('#一#二')
    const ranges = tagRanges(handle.editor)
    expect(ranges[0].to).toBe(ranges[1].from)
    const r = tagKeydown(handle.editor, 'Backspace', ranges[0].to)
    expect(r.handled).toBe(true)
    expect(plainText(handle.editor)).toBe('#二')
    destroyDecoratedEditor(handle)
  })

  it('Backspace：tag 后紧跟标点（#标签,）→ 只删 tag，保留标点', () => {
    tagTable = {}
    const handle = createDecoratedEditor('看 #标签,继续')
    const { to } = tagRanges(handle.editor)[0]
    const r = tagKeydown(handle.editor, 'Backspace', to)
    expect(r.handled).toBe(true)
    expect(plainText(handle.editor)).toBe('看 ,继续')
    destroyDecoratedEditor(handle)
  })

  it('边界：`#` 单独不是单元（TAG_PATTERN 要求 ≥1 名字字符）→ 无装饰、Backspace 不拦截', () => {
    tagTable = {}
    const handle = createDecoratedEditor('空 # 号')
    expect(handle.element.querySelectorAll('span.block-tag')).toHaveLength(0)
    expect(tagRanges(handle.editor)).toHaveLength(0)
    const r = tagKeydown(handle.editor, 'Backspace', 3)
    expect(r.handled).toBe(false)
    destroyDecoratedEditor(handle)
  })

  it('ArrowRight：光标在 tag 左缘 → 整体跨到右 pad 后；ArrowLeft：右缘 → 跨回左 pad 前', () => {
    tagTable = {}
    const handle = createDecoratedEditor('任务 #标签 完成')
    const { from, to } = tagRanges(handle.editor)[0]
    const rRight = tagKeydown(handle.editor, 'ArrowRight', from)
    expect(rRight.handled).toBe(true)
    expect(handle.editor.state.selection.from).toBe(to + 1)
    const rLeft = tagKeydown(handle.editor, 'ArrowLeft', to)
    expect(rLeft.handled).toBe(true)
    expect(handle.editor.state.selection.from).toBe(from - 1)
    destroyDecoratedEditor(handle)
  })

  it('菜单打开中（正在输入 #que）→ Backspace / ArrowRight 放行逐字符，不整删不跨越', async () => {
    tagTable = {}
    const element = document.createElement('div')
    document.body.appendChild(element)
    const editor = new Editor({
      element,
      extensions: [
        Document,
        Paragraph,
        Text,
        InlineTagExtension.configure({ resolve: title => tagTable[title] }),
        InlineTagTriggerExtension,
      ],
      content: '<p>任务 #que</p>',
    })
    const { to } = tagRanges(editor)[0]
    editor.commands.setTextSelection(to)
    // 走真实输入路径：handleTextInput → setTimeout 内检测 → 菜单打开
    const triggerPlugin = editor.state.plugins.find(p => typeof p.spec.props?.handleTextInput === 'function')
    triggerPlugin!.spec.props.handleTextInput!(editor.view, to, to, 'x')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(isTagMenuOpen()).toBe(true)

    const rBs = tagKeydown(editor, 'Backspace', to)
    expect(rBs.handled).toBe(false)
    expect(rBs.preventDefaultCalled).toBe(false)
    expect(plainText(editor)).toBe('任务 #que')
    const rArrow = tagKeydown(editor, 'ArrowRight', to)
    expect(rArrow.handled).toBe(false)
    expect(rArrow.preventDefaultCalled).toBe(false)

    editor.destroy()
    element.remove()
  })
})
