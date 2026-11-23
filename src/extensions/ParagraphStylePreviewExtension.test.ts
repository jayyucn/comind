import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { TextSelection } from '@tiptap/pm/state'

import { ParagraphStylePreviewExtension } from './ParagraphStylePreviewExtension'

interface DecorationHandle {
  editor: Editor
  element: HTMLElement
}

const handles: DecorationHandle[] = []

/**
 * 用 JSON 建文档而不是 `<p>${text}</p>`：HTML 解析会把段尾空格吃掉，
 * `# `（空标题）这类用例过不去。
 *
 * 默认把光标放在文档末尾；`caret` 参数用来验证「光标停在前缀上时装饰不变」
 * （前缀是恒定隐藏的，插入符高度由 CSS 的 inline-block 保证，与光标位置无关）。
 */
function createEditor(text: string, caret?: number | 'end'): DecorationHandle {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({
    element,
    extensions: [Document, Paragraph, Text, ParagraphStylePreviewExtension],
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
    },
  })
  const handle = { editor, element }
  handles.push(handle)
  putCaret(handle, caret === undefined || caret === 'end' ? editor.state.doc.content.size - 1 : caret)
  return handle
}

/** 把光标放到文档的指定位置（模拟「光标进前缀」这类重算场景） */
function putCaret(handle: DecorationHandle, pos: number): void {
  const { state, view } = handle.editor
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos)))
}

/** 被藏起来的原文（`textContent` 会把 `display:none` 的字也算进去，故单独取） */
function hiddenText(handle: DecorationHandle): string | null {
  return handle.element.querySelector('.pm-prefix-hidden')?.textContent ?? null
}

/** widget 标记的文本（`H1` / `•` / `7.`） */
function markerText(handle: DecorationHandle): string | null {
  return handle.element.querySelector('.pm-prefix-marker')?.textContent ?? null
}

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.editor.destroy()
    handle.element.remove()
  }
})

describe('ParagraphStylePreviewExtension — 编辑态前缀换标记', () => {
  it('标题：`# ` 藏起来，整行放大，不出标记（渲染态标题也没有标记列）', () => {
    const handle = createEditor('# 标题')
    expect(hiddenText(handle)).toBe('# ')
    expect(markerText(handle)).toBeNull()
    expect(handle.element.innerHTML).toContain('heading-preview-h1')
  })

  it('标题前缀带上同级字号类：插入符高度才和标题正文一致', () => {
    const handle = createEditor('# 标题')
    const hidden = handle.element.querySelector('.pm-prefix-hidden') as HTMLElement | null
    // 只借 font-size token；宽度由 CSS 的 `width: 0` 压住，类名变大不会撑开布局
    expect(hidden?.className).toBe('pm-prefix-hidden heading-preview-h1')
    // 标题正文仍是独立的一段：与前缀是两个装饰，不会被合并成同一个 span
    const title = handle.element.querySelector('.heading-preview') as HTMLElement | null
    expect(title?.textContent).toBe('标题')
  })

  it('藏前缀不动文档：保存与光标偏移的依据仍是完整正文', () => {
    const handle = createEditor('## 标题')
    expect(handle.editor.getText()).toBe('## 标题')
  })

  it('无序列表：出 `•` 标记，不放大（前缀也不带标题字号类）', () => {
    const handle = createEditor('- 条目')
    expect(hiddenText(handle)).toBe('- ')
    expect(markerText(handle)).toBe('•')
    expect(handle.element.innerHTML).not.toContain('heading-preview')
    expect(handle.element.querySelector('.pm-prefix-hidden')?.className).toBe('pm-prefix-hidden')
  })

  it('有序列表：标记用正文里的序号', () => {
    const handle = createEditor('7. 第七项')
    expect(hiddenText(handle)).toBe('7. ')
    expect(markerText(handle)).toBe('7.')
    expect(handle.element.innerHTML).toContain('pm-prefix-marker-ordered')
  })

  it('h4–h6：样式格不认（style 为 null），但放大仍按级别走', () => {
    const handle = createEditor('#### 四级')
    expect(hiddenText(handle)).toBe('#### ')
    expect(markerText(handle)).toBeNull()
    expect(handle.element.innerHTML).toContain('heading-preview-h4')
    // 前缀同样带上级别字号类：插入符高度才与正文一致
    expect(handle.element.querySelector('.pm-prefix-hidden')?.className).toBe(
      'pm-prefix-hidden heading-preview-h4',
    )
  })

  it('普通文本：没有任何前缀装饰', () => {
    const handle = createEditor('随便写点')
    expect(handle.element.innerHTML).not.toContain('pm-prefix')
    expect(handle.element.innerHTML).not.toContain('heading-preview')
  })

  it('空标题 `# `：敲下空格就认（不必等第一个字）', () => {
    const handle = createEditor('# ')
    expect(hiddenText(handle)).toBe('# ')
  })

  it('光标落进前缀（行首 / 前缀里 / 正文第一个字左边）也不露原文', () => {
    // `# ` 占 2 格：1 = 行首，2 = `#` 之后，3 = 正文第一个字左边
    for (const pos of [1, 2, 3]) {
      const handle = createEditor('# 标题')
      putCaret(handle, pos)
      expect(hiddenText(handle), `pos=${pos} 不该露出原文`).toBe('# ')
      expect(handle.element.innerHTML).toContain('heading-preview-h1')
    }
  })

  it('光标贴列表前缀时也照常藏，`•` 不摘（字符是透明的，不会与标记重影）', () => {
    const handle = createEditor('- 条目')
    putCaret(handle, 3)
    expect(hiddenText(handle)).toBe('- ')
    expect(markerText(handle)).toBe('•')
  })

  it('光标离开前缀一格：装饰完全不变（装饰与光标位置无关）', () => {
    const handle = createEditor('- 条目')
    putCaret(handle, 4)
    expect(hiddenText(handle)).toBe('- ')
    expect(markerText(handle)).toBe('•')
  })
})
