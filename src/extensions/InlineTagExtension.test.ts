import { describe, it, expect, vi, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import type { EditorView } from '@tiptap/pm/view'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { InlineTagExtension, INLINE_TAG_CLICK_EVENT } from './InlineTagExtension'
import type { InlineTagClickPayload } from './InlineTagExtension'
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
    // PM 会为块尾光标锚点 widget 自动插入无 src 的 ProseMirror-separator img
    //（inline-unit-keyboard 块尾锚点），故只断言恶意 img 特征与 chip 内无 img
    expect(handle.renderedHTML).not.toContain('onerror')
    expect(handle.renderedHTML).not.toContain('src=x')
    const chip = handle.element.querySelector('.block-tag')
    expect(chip?.querySelector('img')).toBeNull()
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

  // ── chip-pop 入场门控（ADR-0052 闪入门控）：动画类只挂「本次事务新生成」的单元 ──
  it('挂载已有 #tag：装饰不带 chip-pop（两态切换重建不闪跳）', () => {
    tagTable = { 标签: { color: '--tag-color-3', is_system: false } }
    const handle = createDecoratedEditor('这是 #标签')
    expect(handle.renderedHTML).toContain('block-tag')
    expect(handle.renderedHTML).not.toContain('chip-pop')
    destroyDecoratedEditor(handle)
  })

  it('事务新生成的 #tag：装饰带 chip-pop 播入场动画', () => {
    tagTable = {}
    const handle = createDecoratedEditor('before ')
    handle.editor.commands.insertContent('#新标签')
    expect(handle.element.innerHTML).toContain('block-tag chip-pop')
    destroyDecoratedEditor(handle)
  })

  it('pop 进行中的选区事务：chip-pop 类保持；下一个文档事务后移除', () => {
    tagTable = {}
    const handle = createDecoratedEditor('before ')
    handle.editor.commands.insertContent('#新标签')
    // 选区事务（光标落 doc 起点、不在单元内）：fresh 保持，chip-pop 不被抖掉
    handle.editor.commands.setTextSelection(1)
    expect(handle.element.innerHTML).toContain('block-tag chip-pop')
    // 下一个文档事务（单元外插入）：chip-pop 移除，不随重渲染重播
    handle.editor.commands.insertContent(' tail')
    expect(handle.element.innerHTML).toContain('block-tag')
    expect(handle.element.innerHTML).not.toContain('chip-pop')
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


// ─── 编辑态 chip 点击 → 标签聚合页（与渲染态同口径，ADR-0050 D7） ───────────
// 链路：PM handleClick → inlineTagClick CustomEvent → editorEvents → navigateToTag。
// 本块只验扩展侧派发条件与载荷；editorEvents 消费见 Block/__tests__/editorEvents.test.ts。

/** 取 inlineTag 装饰插件的 handleClick（真实 view 驱动；键盘插件挂的是 handleKeyDown） */
function tagClickHandler(editor: Editor) {
  // 从活编辑器的插件列表按 prop 查找（与键盘测试同范式）：装饰插件是唯一挂
  // handleClick 的；不能走 Extension.config 直调 —— addProseMirrorPlugins 读
  // this.options.resolve，未绑定时会炸。
  const plugin = editor.state.plugins.find(p => typeof p?.spec?.props?.handleClick === 'function')
  const handleClick = plugin?.spec.props.handleClick as
    | ((view: EditorView, pos: number, event: MouseEvent) => boolean)
    | undefined
  expect(handleClick).toBeTypeOf('function')
  return handleClick!
}

describe('InlineTagExtension — 编辑态 chip 点击（inlineTagClick）', () => {
  it('点击 #标签 chip → 派发 inlineTagClick（tagId 来自 resolve）', () => {
    tagTable = { 标签: { color: '--tag-color-3', is_system: false, id: 'tag-1' } }
    const handle = createDecoratedEditor('任务 #标签 完成')
    const chip = handle.element.querySelector('span.block-tag')
    expect(chip).not.toBeNull()
    const dispatched: CustomEvent<InlineTagClickPayload>[] = []
    chip!.addEventListener(INLINE_TAG_CLICK_EVENT, e =>
      dispatched.push(e as CustomEvent<InlineTagClickPayload>))
    // '任务 #标签 完成'：# 起点 4，点击落在 # 上（单元内）
    const handled = tagClickHandler(handle.editor)(
      handle.editor.view, 4, { target: chip } as unknown as MouseEvent)
    expect(handled).toBe(true)
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].detail.tagId).toBe('tag-1')
    expect(dispatched[0].detail.title).toBe('标签')
    destroyDecoratedEditor(handle)
  })

  it('resolve 查无此 tag（未落库）→ 不派发（与渲染态缺 data-tag-id 同口径）', () => {
    tagTable = {}
    const handle = createDecoratedEditor('任务 #标签 完成')
    const chip = handle.element.querySelector('span.block-tag')
    const dispatched: Event[] = []
    chip!.addEventListener(INLINE_TAG_CLICK_EVENT, e => dispatched.push(e))
    const handled = tagClickHandler(handle.editor)(
      handle.editor.view, 4, { target: chip } as unknown as MouseEvent)
    expect(handled).toBe(false)
    expect(dispatched).toHaveLength(0)
    destroyDecoratedEditor(handle)
  })

  it('点击非 chip 区域 → 不派发', () => {
    tagTable = { 标签: { color: '--tag-color-3', is_system: false, id: 'tag-1' } }
    const handle = createDecoratedEditor('任务 #标签 完成')
    const pm = handle.element.querySelector('.ProseMirror')
    const dispatched: Event[] = []
    pm!.addEventListener(INLINE_TAG_CLICK_EVENT, e => dispatched.push(e))
    const handled = tagClickHandler(handle.editor)(
      handle.editor.view, 2, { target: pm } as unknown as MouseEvent)
    expect(handled).toBe(false)
    expect(dispatched).toHaveLength(0)
    destroyDecoratedEditor(handle)
  })

  it('点击 chip 后选区还原到点击前位置（不落进 chip 内部）', () => {
    tagTable = { 标签: { color: '--tag-color-3', is_system: false, id: 'tag-1' } }
    const handle = createDecoratedEditor('任务 #标签 完成')
    const chip = handle.element.querySelector('span.block-tag')
    // 同一插件实例：mousedown 与 handleClick 共享 preClickSel 闭包
    const plugin = handle.editor.state.plugins.find(
      p => typeof p?.spec?.props?.handleClick === 'function'
    )
    const mousedown = plugin?.spec.props.handleDOMEvents?.mousedown as
      (view: EditorView, event: MouseEvent) => boolean
    const click = plugin?.spec.props.handleClick as
      (view: EditorView, pos: number, event: MouseEvent) => boolean

    // 点击前选区放到块首（单元 [3,6) 之外），记录 PM 规范后的实际位置
    handle.editor.commands.setTextSelection(0)
    const expectedFrom = handle.editor.state.selection.from
    const expectedTo = handle.editor.state.selection.to
    mousedown(handle.editor.view, { target: chip } as unknown as MouseEvent)
    const handled = click(handle.editor.view, 4, { target: chip } as unknown as MouseEvent)

    expect(handled).toBe(true)
    // 选区应回到点击前的位置，而非落进 chip [3,6) 内部
    expect(handle.editor.state.selection.from).toBe(expectedFrom)
    expect(handle.editor.state.selection.to).toBe(expectedTo)
    expect(handle.editor.state.selection.from).toBeLessThan(3)
    destroyDecoratedEditor(handle)
  })
})

// ─── handleDOMEvents.mousedown：记录点击前选区 ───────────────────────────────
// 编辑态点击 #tag chip 不应把文本光标插进 chip 内部（chip 是原子单元，落光标会让用户
// 敲坏 `#tag` 文本）。mousedown 命中 chip 时仅记录点击前选区、不拦截（返回 false、不
// preventDefault）——PM 的 handleClick 由 mousedown 阶段创建的 LeftMouseDown 在
// mouseup 触发，一旦跳过则点击行为整体失效；选区还原在 handleClick 内完成。

/** 取 inlineTag 装饰插件的 mousedown 守卫（活编辑器插件列表，与 click 同范式） */
function tagMousedownHandler(editor: Editor) {
  const plugin = editor.state.plugins.find(p => typeof p?.spec?.props?.handleDOMEvents?.mousedown === 'function')
  const mousedown = plugin?.spec.props.handleDOMEvents?.mousedown as
    | ((view: EditorView, event: MouseEvent) => boolean)
    | undefined
  expect(mousedown).toBeTypeOf('function')
  return mousedown!
}

describe('InlineTagExtension mousedown guard', () => {
  it('chip 目标 → 不拦截（返回 false、不 preventDefault），仅记录点击前选区', () => {
    tagTable = { 标签: { color: '--tag-color-3', is_system: false, id: 'tag-1' } }
    const handle = createDecoratedEditor('任务 #标签 完成')
    const chip = handle.element.querySelector('span.block-tag')
    expect(chip).not.toBeNull()
    const preventDefault = vi.fn()
    const ret = tagMousedownHandler(handle.editor)(
      handle.editor.view,
      { target: chip, preventDefault } as unknown as MouseEvent
    )
    expect(preventDefault).not.toHaveBeenCalled()
    expect(ret).toBe(false)
    destroyDecoratedEditor(handle)
  })

  it('非 chip 目标 → 不 preventDefault', () => {
    tagTable = {}
    const handle = createDecoratedEditor('任务 #标签 完成')
    const pm = handle.element.querySelector('.ProseMirror')
    const preventDefault = vi.fn()
    const ret = tagMousedownHandler(handle.editor)(
      handle.editor.view,
      { target: pm, preventDefault } as unknown as MouseEvent
    )
    expect(preventDefault).not.toHaveBeenCalled()
    expect(ret).toBe(false)
    destroyDecoratedEditor(handle)
  })
})
