import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { TAG_TRIGGER_SOURCE } from '../composables/useContentRenderer'

/**
 * tiptap 扩展：编辑态把 inline `#tag` 的 `#` 号装饰成 `.tag-hash`（图标）。
 *
 * 与渲染态同源：正则 source 复用 `useContentRenderer` 的 `TAG_TRIGGER_SOURCE`，
 * 类名复用渲染态吐出的 `tag-hash`，图标样式只写一次（`_block.scss`）。
 * 装饰只加 class 不改文档内容，`#` 仍是文本节点里的字符 —— 光标/选区偏移不变。
 *
 * 与 `WikiLinkExtension` 的 `[[` / `]]` 装饰同一手法，区别是这里只装饰 `#`
 * 一个字符（tag 名本身保持正文样式）。
 */
export const InlineTagExtension = Extension.create({
  name: 'inlineTag',

  addProseMirrorPlugins() {
    // 独立实例：不复用渲染器的全局正则对象，避免 lastIndex 互踩
    const tagRegex = new RegExp(TAG_TRIGGER_SOURCE, 'gu')

    return [
      new Plugin({
        key: new PluginKey('inlineTag'),
        props: {
          decorations(state) {
            const decorations: Decoration[] = []

            state.doc.descendants((node, pos) => {
              if (!node.isText) return
              const text = node.text || ''
              tagRegex.lastIndex = 0
              let match: RegExpExecArray | null
              while ((match = tagRegex.exec(text)) !== null) {
                // match[0] = '#tag'，`#` 位于 match.index，长度 1
                const hashStart = pos + match.index
                decorations.push(Decoration.inline(hashStart, hashStart + 1, { class: 'tag-hash' }))
              }
            })

            return DecorationSet.create(state.doc, decorations)
          },
        },
        state: {
          init() {
            return DecorationSet.empty
          },
          apply(tr, prev) {
            return prev.map(tr.mapping, tr.doc)
          },
        },
      }),
    ]
  },
})
