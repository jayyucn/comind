import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const HeadingPreviewExtension = Extension.create({
  name: 'headingPreview',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('headingPreview'),
        props: {
          decorations(state) {
            const decorations: Decoration[] = []
            const { doc } = state

            doc.descendants((node, pos) => {
              if (!node.isText) return
              const text = node.text || ''
              if (!text.startsWith('#')) return

              const headingMatch = text.match(/^(#{1,6})\s+/)
              if (!headingMatch) return

              const level = headingMatch[1].length
              decorations.push(
                Decoration.inline(pos, pos + text.length, {
                  class: `heading-preview heading-preview-h${level}`
                })
              )
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