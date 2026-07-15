import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { TextSelection } from '@tiptap/pm/state'

interface PairConfig {
  open: string
  close: string
}

const PAIRS: PairConfig[] = [
  { open: '[', close: ']' },
  { open: '(', close: ')' },
  { open: '{', close: '}' },
]

const pluginKey = new PluginKey('bracketPair')

const BracketPairExtension = Extension.create({
  name: 'bracketPair',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pluginKey,
        props: {
          handleTextInput(view, from, to, text) {
            for (const pair of PAIRS) {
              if (text === pair.open) {
                const tr = view.state.tr.insertText(pair.close, to, to)
                tr.insertText(pair.open, from, to)
                const newPos = from + 1
                tr.setSelection(TextSelection.create(tr.doc, newPos))
                view.dispatch(tr)
                return true
              }
            }
            return false
          },

          handleKeyDown(view, event) {
            if (event.key === 'Backspace') {
              const { state } = view
              const { selection } = state
              const { empty } = selection

              if (!empty) return false

              const pos = selection.from

              for (const pair of PAIRS) {
                const charBefore = pos > 0 ? state.doc.textBetween(pos - 1, pos) : ''
                const charAfter = pos < state.doc.content.size ? state.doc.textBetween(pos, pos + 1) : ''

                if (charBefore === pair.open && charAfter === pair.close) {
                  view.dispatch(state.tr.delete(pos - 1, pos + 1))
                  return true
                }
              }
            }
            return false
          }
        }
      })
    ]
  }
})

export default BracketPairExtension
