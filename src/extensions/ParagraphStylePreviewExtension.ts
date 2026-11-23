import { Extension } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import type { ParagraphStyleInfo } from '../composables/useContentRenderer'
import { parseParagraphStyle } from '../composables/useContentRenderer'

/**
 * 编辑态段落样式预览（标题放大 + 前缀换标记）。
 *
 * 本库的标题与列表都是**正文前缀**（`# ` / `- ` / `1. `），不是块类型，所以正文里真的
 * 存着这几个字符。编辑时把它们直接摊在光标边上很难看（`# 标题` 里那个 `#` 会跟着标题
 * 一起变大），于是这里做两件事：
 *
 * 1. **藏起来**：前缀范围内的字符套 `pm-prefix-hidden`（零字号，见 Editor.vue 的样式）；
 * 2. **换成标记**：列表项在前缀起点放一个 widget（无序 `•`、有序出序号），与渲染态
 *    `.block-list-marker` 同宽同色 —— 两态文字起点因此落在同一列。标题**不出标记**：
 *    渲染态的标题本来就没有标记列，再摆一个 `H1` 字牌反而让两态文字起点差一列。
 *
 * 文档内容一个字都不改（只是视觉装饰），所以保存、撤销、光标偏移、跨块选区全都不受影响。
 *
 * 唯一的例外是**光标停在前缀内部**（两端不算）时整段不装饰：那几格字既看不见又改不了
 * 就没法用键盘修前缀（比如退格把 `- ` 拆掉退出列表）。
 */

interface PrefixMarker {
  /** 顶替正文字符的那个标记文本 */
  label: string
  /** 决定样式与对齐（见 Editor.vue 的 `.pm-prefix-marker-*`） */
  kind: 'unordered' | 'ordered'
}

/** 前缀 → 标记；标题与无前缀返回 null */
function markerOf(info: ParagraphStyleInfo): PrefixMarker | null {
  if (info.style === 'ul') return { label: '•', kind: 'unordered' }
  if (info.style === 'ol') return { label: `${info.listIndex ?? 1}.`, kind: 'ordered' }
  return null
}

function createMarkerElement(marker: PrefixMarker): HTMLElement {
  const el = document.createElement('span')
  el.className = `pm-prefix-marker pm-prefix-marker-${marker.kind}`
  el.textContent = marker.label
  // 标记是正文的替代品、不是可编辑内容：不接光标、不接指针、读屏跳过
  el.setAttribute('contenteditable', 'false')
  el.setAttribute('aria-hidden', 'true')
  return el
}

/** 从文档状态算出全部装饰（导出供单测直接调用） */
export function buildParagraphStyleDecorations(state: EditorState): DecorationSet {
  const decorations: Decoration[] = []
  const { doc, selection } = state

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    const text = node.textContent
    // allowEmptyTitle：敲下 `# ` 就该立刻认成标题，不必等第一个标题字
    const info = parseParagraphStyle(text, { allowEmptyTitle: true })
    if (info.prefixLength === 0) return false

    const from = pos + 1
    const prefixEnd = from + info.prefixLength
    const caretInPrefix = selection.empty && selection.from > from && selection.from < prefixEnd

    if (!caretInPrefix) {
      decorations.push(Decoration.inline(from, prefixEnd, { class: 'pm-prefix-hidden' }))
      const marker = markerOf(info)
      if (marker) {
        decorations.push(Decoration.widget(from, () => createMarkerElement(marker), { side: -1 }))
      }
    }

    // 标题整行放大：类名与样式沿用既有的 heading-preview（含 h4–h6 的弱化）。
    // 范围**从前缀之后起**，不含前缀 —— 两者若都从 pos 1 起，ProseMirror 会把两个
    // inline 装饰合并到同一个 span 上（`pm-prefix-hidden heading-preview-h1`），
    // 标题的 font-size 就把「零字号」覆盖回 24px，前缀虽然 transparent 却仍占宽度。
    if (info.level) {
      decorations.push(
        Decoration.inline(prefixEnd, from + text.length, {
          class: `heading-preview heading-preview-h${info.level}`,
        }),
      )
    }

    return false
  })

  return DecorationSet.create(doc, decorations)
}

export const ParagraphStylePreviewExtension = Extension.create({
  name: 'paragraphStylePreview',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('paragraphStylePreview'),
        props: {
          // 每次渲染按当前文档 + 选区重算（选区一变也要重算：光标进前缀就要露出原文）
          decorations(state) {
            return buildParagraphStyleDecorations(state)
          },
        },
      }),
    ]
  },
})
