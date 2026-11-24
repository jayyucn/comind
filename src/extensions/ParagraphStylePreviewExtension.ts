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
 * 2. **换成标记**：列表项在前缀 span 上挂 `data-marker`，由 **`::before` 伪元素**画出
 *    标记（无序 `•`、有序出序号），与渲染态 `.block-list-marker` 同宽同色 —— 两态文字
 *    起点因此落在同一列。标题**不出标记**：渲染态的标题本来就没有标记列，再摆一个
 *    `H1` 字牌反而让两态文字起点差一列。
 *
 * 文档内容一个字都不改（只是视觉装饰），所以保存、撤销、光标偏移、跨块选区全都不受影响。
 *
 * **标记为什么必须是伪元素而不是 widget 节点**：Chromium 的三连击/整段选区在初始绘制时
 * 会把选区内的非可编辑 widget 字形**重影到文字起点**（ol 第二项实测：灰 `2.` 叠进选区
 * 里的 `2` 上成贯穿线），且该路径无视 `::selection`/`visibility`/`opacity`/`user-select`
 * （全部实测无效），选区落定后的任何一次重绘才恢复正常。伪元素不是 DOM 文本，选区
 * 管线根本碰不到它 —— 这是唯一在不改文档的前提下按得住的画法。
 *
 * 前缀**始终**藏起来，不因光标位置露出（`# ` 在标题里露出来比什么都显眼）。能不能藏得住
 * 全看 Editor.vue 里 `.pm-prefix-hidden` 的写法：布局宽度压成 0、字号与所在段落一致，
 * 插入符才有高度。别退回 `font-size: 0` —— 那样连插入符高度一起归零，光标贴到前缀
 * 就整个消失（实测 `Range.getClientRects()` h=0）。
 *
 * 标题的前缀还要**带上同级字号类**（`heading-preview-hN`）：插入符高度取所在文本的字号
 * 度量，前缀若停在正文默认字号，行首那颗光标就比标题正文矮一截（16px 前缀 24px 高、
 * h1 正文 35px 高）。宽度由 `width: 0` 硬压，字号变大不会撑开布局。
 */

/** 前缀 → 标记；标题与无前缀返回 null */
function markerOf(info: ParagraphStyleInfo): { label: string, kind: 'unordered' | 'ordered' } | null {
  if (info.style === 'ul') return { label: '•', kind: 'unordered' }
  if (info.style === 'ol') return { label: `${info.listIndex ?? 1}.`, kind: 'ordered' }
  return null
}

/** 从文档状态算出全部装饰（导出供单测直接调用） */
export function buildParagraphStyleDecorations(state: EditorState): DecorationSet {
  const decorations: Decoration[] = []
  const { doc } = state

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    const text = node.textContent
    // allowEmptyTitle：敲下 `# ` 就该立刻认成标题，不必等第一个标题字
    const info = parseParagraphStyle(text, { allowEmptyTitle: true })
    if (info.prefixLength === 0) return false

    const from = pos + 1
    const prefixEnd = from + info.prefixLength

    // 标题的前缀要**跟着标题字号走**：插入符高度取所在文本的字号度量，前缀盒若停在
    // 正文默认字号（16px），行首那颗光标只有 24px 高，标题正文处却是 35px —— 同一个
    // 块里两种高度的光标（用户实测截图：行首 24px、正文 35px）。
    // 借 `heading-preview-hN` 只是为了拿它的 `font-size` token；宽度由 `.pm-prefix-hidden`
    // 的 `width: 0` 硬压，字号变大不会撑开布局（早先 `font-size: 0` 时代踩过这个坑）。
    const prefixClass = info.level
      ? `pm-prefix-hidden heading-preview-h${info.level}`
      : 'pm-prefix-hidden'

    // 标记经 data-* 下发给伪元素（见 Editor.vue 的 `.pm-prefix-hidden[data-marker]::before`）；
    // 绝不能回到 widget 节点 —— 选区初始绘制会把它重影进选区（见文件头注释）。
    const marker = markerOf(info)
    const attrs: Record<string, string> = { class: prefixClass }
    if (marker) {
      attrs['data-marker'] = marker.label
      attrs['data-marker-kind'] = marker.kind
    }
    decorations.push(Decoration.inline(from, prefixEnd, attrs))

    // 标题整行放大：类名与样式沿用既有的 heading-preview（含 h4–h6 的弱化）。
    // 范围**必须从前缀之后起**：若从 pos 1 起，ProseMirror 会把两个 inline 装饰合并到同一个
    // span 上，前缀那条 `display:inline-block; width:0` 就盖住整段标题 —— 标题跟着一起塞进
    // 零宽盒里溢出绘制，而前缀是 `color: transparent`，整行字直接看不见。
    if (info.level) {
      decorations.push(
        Decoration.inline(prefixEnd, from + node.content.size, {
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
          // 每次渲染按当前文档重算（前缀始终隐藏，与选区无关）
          decorations(state) {
            return buildParagraphStyleDecorations(state)
          },
        },
      }),
    ]
  },
})
