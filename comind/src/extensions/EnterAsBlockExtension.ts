import { Extension } from '@tiptap/core'

const EnterAsBlockExtension = Extension.create({
  name: 'enterAsBlock',
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        editor.view.dom.dispatchEvent(new CustomEvent('enter-as-block', {
          bubbles: true,
          detail: { type: 'split', pos: editor.state.selection.from }
        }))
        return true
      },
      'Shift-Enter': () => false,
      Backspace: ({ editor }) => {
        const { $from } = editor.state.selection
        const content = editor.getText()
        if (content.length === 0) {
          editor.view.dom.dispatchEvent(new CustomEvent('enter-as-block', {
            bubbles: true,
            detail: { type: 'delete' }
          }))
          return true
        } else if ($from.parentOffset === 0) {
          editor.view.dom.dispatchEvent(new CustomEvent('enter-as-block', {
            bubbles: true,
            detail: { type: 'merge' }
          }))
          return true
        }
        return false
      },
      Tab: ({ editor }) => {
        editor.view.dom.dispatchEvent(new CustomEvent('enter-as-block', {
          bubbles: true,
          detail: { type: 'indent' }
        }))
        return true
      },
      'Shift-Tab': ({ editor }) => {
        editor.view.dom.dispatchEvent(new CustomEvent('enter-as-block', {
          bubbles: true,
          detail: { type: 'outdent' }
        }))
        return true
      },
      ArrowUp: ({ editor }) => {
        const { $from } = editor.state.selection
        if ($from.parentOffset === 0) {
          editor.view.dom.dispatchEvent(new CustomEvent('enter-as-block', {
            bubbles: true,
            detail: { type: 'moveUp' }
          }))
          return true
        }
        return false
      },
      ArrowDown: ({ editor }) => {
        const { $from } = editor.state.selection
        if ($from.parentOffset === $from.parent.content.size) {
          editor.view.dom.dispatchEvent(new CustomEvent('enter-as-block', {
            bubbles: true,
            detail: { type: 'moveDown' }
          }))
          return true
        }
        return false
      },
      Escape: ({ editor }) => {
        editor.view.dom.dispatchEvent(new CustomEvent('enter-as-block', {
          bubbles: true,
          detail: { type: 'exitEdit' }
        }))
        return true
      },
      'Mod-s': ({ editor }) => {
        editor.view.dom.dispatchEvent(new CustomEvent('enter-as-block', {
          bubbles: true,
          detail: { type: 'save' }
        }))
        return true
      },
    }
  }
})

export default EnterAsBlockExtension
