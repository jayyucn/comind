import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import type { EditorView } from '@tiptap/pm/view'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { WikiLinkExtension, WIKI_LINK_CLICK_EVENT } from './WikiLinkExtension'
import type { WikiLinkClickPayload } from './WikiLinkExtension'
import { WikiLinkTriggerExtension, isWikiLinkMenuOpen, closeWikiLinkMenuByEditor } from './WikiLinkTriggerExtension'
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

// ─── 键盘原子语义（共享原语 inline-unit-keyboard 接线） ─────────────────────
// 通用契约矩阵（pad 语义 / 缘带 / 修饰键 / 选区 / IME）由
// inline-unit-keyboard.test.ts 钉死；本块只验 wiki link 语法侧接线：
// 单元范围 = 装饰范围（同源扫描）、typed-paren 整段为一个单元、菜单打开中放行。

/** 驱动真实 view 上挂载的 wikiLinkKeyboard 插件 handleKeyDown（TipTap 会给插件 key 加 `$` 后缀，用前缀匹配） */
function wikiLinkKeydown(editor: Editor, key: string, pos: number) {
  const plugin = editor.state.plugins.find(p => p.key.startsWith('wikiLinkKeyboard'))
  expect(plugin, 'wikiLinkKeyboard 插件未挂载').toBeDefined()
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

function docText(editor: Editor) {
  return editor.state.doc.textContent
}

describe('WikiLinkExtension — 键盘原子语义（共享原语接线）', () => {
  beforeEach(async () => {
    await cleanupRelationshipTypes()
    const { _resetForTest } = useRelationshipTypes()
    _resetForTest()
    const { load } = useRelationshipTypes()
    await load()
  })

  afterEach(async () => {
    closeWikiLinkMenuByEditor()
    await cleanupRelationshipTypes()
    const { _resetForTest } = useRelationshipTypes()
    _resetForTest()
  })

  it('键盘单元与装饰同源：[[X]] 区间数 = block-link 装饰覆盖（外层被 wiki-bracket 拆成 3 段，组合文本即整个 [[X]]）', () => {
    const handle = createDecoratedEditor('See [[X]] for details')
    const spans = handle.element.querySelectorAll('span.block-link')
    // PM 扁平化：外层 .block-link 被首尾 .wiki-bracket 拆成 3 段（既有行为）
    expect(spans.length).toBe(3)
    expect(Array.from(spans).map(s => s.textContent).join('')).toBe('[[X]]')
    expect(spans[0].getAttribute('data-page')).toBe('X')
    destroyDecoratedEditor(handle)
  })

  it('Backspace：光标在 [[X]] 右缘 → 整删（含右邻空格，保留左空格分隔）', () => {
    const handle = createDecoratedEditor('看 [[页面]] 结尾')
    const r = wikiLinkKeydown(handle.editor, 'Backspace', 9)
    expect(r.handled).toBe(true)
    expect(r.preventDefaultCalled).toBe(true)
    expect(docText(handle.editor)).toBe('看 结尾')
    destroyDecoratedEditor(handle)
  })

  it('Backspace：[[X]] 在行尾 → 整删并清左 pad，不留悬挂空格', () => {
    const handle = createDecoratedEditor('只有 [[页面]]')
    const r = wikiLinkKeydown(handle.editor, 'Backspace', 10)
    expect(r.handled).toBe(true)
    expect(docText(handle.editor)).toBe('只有')
    destroyDecoratedEditor(handle)
  })

  it('Backspace：带别名 [[target|显示]] → 整段删除（不剩残缺括号）', () => {
    const handle = createDecoratedEditor('看 [[target|显示]] 尾')
    const r = wikiLinkKeydown(handle.editor, 'Backspace', 16)
    expect(r.handled).toBe(true)
    expect(docText(handle.editor)).toBe('看 尾')
    destroyDecoratedEditor(handle)
  })

  it('Backspace：相邻 [[A]][[B]] 夹缝 → 只删第一个，第二个完整保留', () => {
    const handle = createDecoratedEditor('[[A]][[B]]')
    const r = wikiLinkKeydown(handle.editor, 'Backspace', 6)
    expect(r.handled).toBe(true)
    expect(docText(handle.editor)).toBe('[[B]]')
    destroyDecoratedEditor(handle)
  })

  it('Backspace：typed-paren ((label))[[X]] 整段为一个单元 → 整删，不留悬挂 ((label))', () => {
    const handle = createDecoratedEditor('前置 ((是一个))[[项目A]] 后置')
    // 整段 = ((是一个))[[项目A]]（7+7=14 字符），起点 4（"前置 " 之后）
    const r = wikiLinkKeydown(handle.editor, 'Backspace', 18)
    expect(r.handled).toBe(true)
    expect(docText(handle.editor)).toBe('前置 后置')
    destroyDecoratedEditor(handle)
  })

  it('ArrowRight：光标在 [[X]] 左缘 → 整体跨到右 pad 后；ArrowLeft：右缘 → 跨回左 pad 前', () => {
    const handle = createDecoratedEditor('看 [[页面]] 结尾')
    const rRight = wikiLinkKeydown(handle.editor, 'ArrowRight', 3)
    expect(rRight.handled).toBe(true)
    expect(handle.editor.state.selection.from).toBe(10)
    const rLeft = wikiLinkKeydown(handle.editor, 'ArrowLeft', 9)
    expect(rLeft.handled).toBe(true)
    expect(handle.editor.state.selection.from).toBe(2)
    destroyDecoratedEditor(handle)
  })

  it('菜单打开中（正在输入 [[que）→ Backspace / ArrowRight 放行逐字符，不整删不跨越', async () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const editor = new Editor({
      element,
      extensions: [Document, Paragraph, Text, WikiLinkExtension, WikiLinkTriggerExtension],
      content: '<p>看 [[que</p>',
    })
    // '看 [[que'：[[ 起点 3，token 末 8
    editor.commands.setTextSelection(8)
    const triggerPlugin = editor.state.plugins.find(p => typeof p.spec.props?.handleTextInput === 'function')
    triggerPlugin!.spec.props.handleTextInput!(editor.view, 8, 8, 'x')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(isWikiLinkMenuOpen()).toBe(true)

    const rBs = wikiLinkKeydown(editor, 'Backspace', 8)
    expect(rBs.handled).toBe(false)
    expect(rBs.preventDefaultCalled).toBe(false)
    expect(docText(editor)).toBe('看 [[que')
    const rArrow = wikiLinkKeydown(editor, 'ArrowRight', 8)
    expect(rArrow.handled).toBe(false)
    expect(rArrow.preventDefaultCalled).toBe(false)

    editor.destroy()
    element.remove()
  })
})


// ─── 编辑态 wiki link 点击 → 页面导航（与渲染态同口径） ─────────────────────
// 链路：PM handleClick → wikiLinkClick CustomEvent → editorEvents → navigateToPage。
// 本块只验扩展侧派发条件与载荷；editorEvents 消费见 Block/__tests__/editorEvents.test.ts。

/** 取 wikiLink 装饰插件的 handleClick（真实 view 驱动；键盘插件挂的是 handleKeyDown） */
function wikiClickHandler(editor: Editor) {
  const plugins = WikiLinkExtension.config.addProseMirrorPlugins() ?? []
  const plugin = plugins.find(p => typeof p?.spec?.props?.handleClick === 'function')
  const handleClick = plugin?.spec.props.handleClick as
    | ((view: EditorView, pos: number, event: MouseEvent) => boolean)
    | undefined
  expect(handleClick).toBeTypeOf('function')
  return handleClick!
}

describe('WikiLinkExtension — 编辑态点击（wikiLinkClick）', () => {
  it('点击 [[X]] → 派发 wikiLinkClick { page }', () => {
    const handle = createDecoratedEditor('看 [[页面]] 尾')
    const link = handle.element.querySelector('span.block-link')
    expect(link).not.toBeNull()
    const dispatched: CustomEvent<WikiLinkClickPayload>[] = []
    link!.addEventListener(WIKI_LINK_CLICK_EVENT, e =>
      dispatched.push(e as CustomEvent<WikiLinkClickPayload>))
    const handled = wikiClickHandler(handle.editor)(
      handle.editor.view, 5, { target: link } as unknown as MouseEvent)
    expect(handled).toBe(true)
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].detail.page).toBe('页面')
    destroyDecoratedEditor(handle)
  })

  it('点击 typed-paren 的 [[X]] 部分 → 同样派发（渲染态 typed_link 段一致）', () => {
    const handle = createDecoratedEditor('前置 ((是一个))[[项目A]] 后置')
    // 外层 .block-link 被首尾 .wiki-bracket 拆成 3 段（PM 扁平化，既有行为）——
    // 3 段都带 data-page，取第一段即可
    const links = handle.element.querySelectorAll('span.block-link')
    expect(links.length).toBeGreaterThanOrEqual(1)
    const link = links[0]
    const dispatched: CustomEvent<WikiLinkClickPayload>[] = []
    link.addEventListener(WIKI_LINK_CLICK_EVENT, e =>
      dispatched.push(e as CustomEvent<WikiLinkClickPayload>))
    const handled = wikiClickHandler(handle.editor)(
      handle.editor.view, 9, { target: link } as unknown as MouseEvent)
    expect(handled).toBe(true)
    expect(dispatched[0].detail.page).toBe('项目A')
    destroyDecoratedEditor(handle)
  })

  it('点击非 block-link 区域 → 不派发', () => {
    const handle = createDecoratedEditor('看 [[页面]] 尾')
    const pm = handle.element.querySelector('.ProseMirror')
    const dispatched: Event[] = []
    pm!.addEventListener(WIKI_LINK_CLICK_EVENT, e => dispatched.push(e))
    const handled = wikiClickHandler(handle.editor)(
      handle.editor.view, 1, { target: pm } as unknown as MouseEvent)
    expect(handled).toBe(false)
    expect(dispatched).toHaveLength(0)
    destroyDecoratedEditor(handle)
  })

  it('点击 chip 后选区还原到点击前位置（不落进 chip 内部）', () => {
    const handle = createDecoratedEditor('看 [[页面]] 尾')
    const link = handle.element.querySelector('span.block-link')
    // 同一插件实例：mousedown 与 handleClick 共享 preClickSel 闭包
    const plugin = handle.editor.state.plugins.find(
      p => typeof p?.spec?.props?.handleClick === 'function'
    )
    const mousedown = plugin?.spec.props.handleDOMEvents?.mousedown as
      (view: EditorView, event: MouseEvent) => boolean
    const click = plugin?.spec.props.handleClick as
      (view: EditorView, pos: number, event: MouseEvent) => boolean

    // 点击前选区放到块首（单元 [2,8) 之外），记录 PM 规范后的实际位置
    handle.editor.commands.setTextSelection(0)
    const expectedFrom = handle.editor.state.selection.from
    const expectedTo = handle.editor.state.selection.to
    mousedown(handle.editor.view, { target: link } as unknown as MouseEvent)
    const handled = click(handle.editor.view, 5, { target: link } as unknown as MouseEvent)

    expect(handled).toBe(true)
    // 选区应回到点击前的位置，而非落进 chip [2,8) 内部
    expect(handle.editor.state.selection.from).toBe(expectedFrom)
    expect(handle.editor.state.selection.to).toBe(expectedTo)
    expect(handle.editor.state.selection.from).toBeLessThan(2)
    destroyDecoratedEditor(handle)
  })
})

// ─── handleDOMEvents.mousedown：记录点击前选区 ───────────────────────────────
// 编辑态点击 wiki link chip 不应把文本光标插进 chip 内部（chip 是原子单元，落光标会让
// 用户敲坏 `[[X]]` 文本）。mousedown 命中 chip 时仅记录点击前选区、不拦截（返回 false、
// 不 preventDefault）——PM 的 handleClick 由 mousedown 阶段创建的 LeftMouseDown 在
// mouseup 触发，一旦跳过则点击行为整体失效；选区还原在 handleClick 内完成。

/** 取 wikiLink 装饰插件的 mousedown 守卫 */
function wikiMousedownHandler(editor: Editor) {
  const plugins = WikiLinkExtension.config.addProseMirrorPlugins() ?? []
  const plugin = plugins.find(p => typeof p?.spec?.props?.handleDOMEvents?.mousedown === 'function')
  const mousedown = plugin?.spec.props.handleDOMEvents?.mousedown as
    | ((view: EditorView, event: MouseEvent) => boolean)
    | undefined
  expect(mousedown).toBeTypeOf('function')
  return mousedown!
}

describe('WikiLinkExtension mousedown guard', () => {
  it('chip 目标 → 不拦截（返回 false、不 preventDefault），仅记录点击前选区', () => {
    const handle = createDecoratedEditor('看 [[页面]] 尾')
    const link = handle.element.querySelector('span.block-link')
    expect(link).not.toBeNull()
    const preventDefault = vi.fn()
    const ret = wikiMousedownHandler(handle.editor)(
      handle.editor.view,
      { target: link, preventDefault } as unknown as MouseEvent
    )
    expect(preventDefault).not.toHaveBeenCalled()
    expect(ret).toBe(false)
    destroyDecoratedEditor(handle)
  })

  it('非 chip 目标 → 不 preventDefault', () => {
    const handle = createDecoratedEditor('看 [[页面]] 尾')
    const pm = handle.element.querySelector('.ProseMirror')
    const preventDefault = vi.fn()
    const ret = wikiMousedownHandler(handle.editor)(
      handle.editor.view,
      { target: pm, preventDefault } as unknown as MouseEvent
    )
    expect(preventDefault).not.toHaveBeenCalled()
    expect(ret).toBe(false)
    destroyDecoratedEditor(handle)
  })
})
