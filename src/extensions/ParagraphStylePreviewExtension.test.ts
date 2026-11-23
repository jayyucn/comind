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
 */
function createEditor(text: string): DecorationHandle {
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

  it('前缀的装饰不掺标题样式：两者若同起点会被 PM 合并成一个 span', () => {
    const handle = createEditor('# 标题')
    const hidden = handle.element.querySelector('.pm-prefix-hidden') as HTMLElement | null
    // 合并的后果是标题的 font-size 盖掉「零字号」，前缀看不见却仍占宽（实测 19.6px）
    expect(hidden?.className).toBe('pm-prefix-hidden')
    const title = handle.element.querySelector('.heading-preview-h1') as HTMLElement | null
    expect(title?.textContent).toBe('标题')
  })

  it('藏前缀不动文档：保存与光标偏移的依据仍是完整正文', () => {
    const handle = createEditor('## 标题')
    expect(handle.editor.getText()).toBe('## 标题')
  })

  it('无序列表：出 `•` 标记，不放大', () => {
    const handle = createEditor('- 条目')
    expect(hiddenText(handle)).toBe('- ')
    expect(markerText(handle)).toBe('•')
    expect(handle.element.innerHTML).not.toContain('heading-preview')
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
  })

  it('普通文本：没有任何前缀装饰', () => {
    const handle = createEditor('随便写点')
    expect(handle.element.innerHTML).not.toContain('pm-prefix')
    expect(handle.element.innerHTML).not.toContain('heading-preview')
  })

  it('空标题 `# `：敲下空格就认（不必等第一个字）', () => {
    const handle = createEditor('# ')
    expect(hiddenText(handle)).toBe('# ')
    expect(markerText(handle)).toBeNull()
  })

  it('光标停在前缀里面：露出原文（不然那几格字改不了）', () => {
    const handle = createEditor('# 标题')
    putCaret(handle, 2)
    expect(hiddenText(handle)).toBeNull()
    expect(markerText(handle)).toBeNull()
    // 放大照旧：光标在前缀里也还是标题
    expect(handle.element.innerHTML).toContain('heading-preview-h1')
  })

  it('光标在正文起点（前缀之后）：不露出原文', () => {
    const handle = createEditor('# 标题')
    // `# ` 占 2 格，正文从位置 3 起
    putCaret(handle, 3)
    expect(hiddenText(handle)).toBe('# ')
    expect(markerText(handle)).toBeNull()
  })
})
