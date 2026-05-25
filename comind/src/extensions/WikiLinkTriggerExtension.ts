import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export interface WikiLinkTriggerEvent {
  view: any
  position: number
  range: { from: number; to: number }
}

export const WikiLinkTriggerExtension = Extension.create({
  name: 'wikiLinkTrigger',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('wikiLinkTrigger'),
        props: {
          handleKeyDown: (view, event) => {
            if (event.key !== '[') return false
            
            const { state } = view
            const selection = state.selection
            const pos = selection.from
            
            const $pos = state.doc.resolve(pos)
            const textBefore = $pos.nodeBefore?.text || ''
            
            if (textBefore.endsWith('[')) {
              let from = pos - 1
              let to = pos
              
              if (pos < state.doc.content.size) {
                const charAfter = state.doc.textBetween(pos, pos + 1)
                if (charAfter === ']') {
                  to = pos + 1
                }
              }
              
              const event = new CustomEvent<WikiLinkTriggerEvent>('wiki-link-trigger', {
                bubbles: true,
                detail: {
                  view,
                  position: from,
                  range: { from, to }
                }
              })
              view.dom.dispatchEvent(event)
              return true
            }
            
            return false
          }
        },
        view(view) {
          const handleInput = () => {
            const { state } = view
            const { selection } = state
            const { from } = selection

            if (!selection.empty) return

            const linkRegex = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g
            let foundMatch = false

            state.doc.descendants((node, pos) => {
              if (!node.isText || foundMatch) return

              const text = node.text || ''
              let match
              while ((match = linkRegex.exec(text)) !== null) {
                const start = pos + match.index
                const end = start + match[0].length

                if (from > start && from < end) {
                  const event = new CustomEvent<WikiLinkTriggerEvent>('wiki-link-trigger', {
                    bubbles: true,
                    detail: {
                      view,
                      position: from,
                      range: { from: start, to: end }
                    }
                  })
                  view.dom.dispatchEvent(event)
                  foundMatch = true
                  break
                }
              }
            })
          }

          view.dom.addEventListener('input', handleInput)

          return {
            destroy() {
              view.dom.removeEventListener('input', handleInput)
            }
          }
        }
      })
    ]
  }
})
