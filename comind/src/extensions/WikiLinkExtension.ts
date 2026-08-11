import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/**
 * tiptap 扩展：在编辑状态下渲染 [[page]] 链接
 * 使用 ProseMirror Decoration 在不改变文档结构的情况下添加样式
 */
export const WikiLinkExtension = Extension.create({
  name: 'wikiLink',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('wikiLink'),
        props: {
          decorations(state) {
            const decorations: Decoration[] = []
            const { doc } = state
            const linkOnlyRegex = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g
            const typedLinkRegex = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]\^?\(([^)]+)\)/g

            // 第一遍：收集所有 typed link 范围
            const typedRanges: Array<[number, number]> = []
            doc.descendants((node, pos) => {
              if (!node.isText) return
              const text = node.text || ''
              let m: RegExpExecArray | null
              typedLinkRegex.lastIndex = 0
              while ((m = typedLinkRegex.exec(text)) !== null) {
                typedRanges.push([pos + m.index, pos + m.index + m[0].length])
              }
            })

            // 第二遍：装饰普通 wiki link，跳过 typed range
            doc.descendants((node, pos) => {
              if (!node.isText) return
              const text = node.text || ''
              let match: RegExpExecArray | null
              linkOnlyRegex.lastIndex = 0
              while ((match = linkOnlyRegex.exec(text)) !== null) {
                const start = pos + match.index
                const end = start + match[0].length
                if (typedRanges.some(([s, e]) => start >= s && end <= e)) continue
                const display = match[2] || match[1]

                // 创建装饰：外层 .wiki-link + 首尾 .wiki-bracket，与渲染态结构一致
                decorations.push(
                  Decoration.inline(start, end, {
                    class: 'block-link',
                    'data-page': match[1],
                    'data-display': display
                  }),
                  Decoration.inline(start, start + 2, { class: 'wiki-bracket' }),
                  Decoration.inline(end - 2, end, { class: 'wiki-bracket' })
                )
              }
            })

            return DecorationSet.create(doc, decorations)
          },
        },
        state: {
          init() {
            return DecorationSet.empty
          },
          apply(tr, prev) {
            return prev.map(tr.mapping, tr.doc)
          }
        },
      })
    ]
  }
})
