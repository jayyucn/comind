import { Extension } from '@tiptap/core'
import { hasModalOpen } from '../composables/useModalKeyboard'

const EnterAsBlockExtension = Extension.create({
  name: 'enterAsBlock',

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        if (hasModalOpen()) return false

        editor.view.dom.dispatchEvent(new CustomEvent('enter-as-block', {
          bubbles: true,
          detail: { type: 'split', pos: editor.state.selection.from }
        }))
        return true
      },

      'Shift-Enter': () => false,

      Backspace: ({ editor }) => {
        // Backspace 不受模态层影响（模态层通常自己处理）
        const { $from, from, to} = editor.state.selection
        const content = editor.getText()
       
        if (content.length === 0) {
          editor.view.dom.dispatchEvent(new CustomEvent('enter-as-block', {
            bubbles: true,
            detail: { type: 'delete' }
          }))
          return true
        } else if ($from.parentOffset === 0 && from === to) {
          editor.view.dom.dispatchEvent(new CustomEvent('enter-as-block', {
            bubbles: true,
            detail: { type: 'merge' }
          }))
          return true
        }
        return false
      },

      Tab: ({ editor }) => {
        if (hasModalOpen()) return false

        editor.view.dom.dispatchEvent(new CustomEvent('enter-as-block', {
          bubbles: true,
          detail: { type: 'indent' }
        }))
        return true
      },

      'Shift-Tab': ({ editor }) => {
        if (hasModalOpen()) return false

        editor.view.dom.dispatchEvent(new CustomEvent('enter-as-block', {
          bubbles: true,
          detail: { type: 'outdent' }
        }))
        return true
      },

      ArrowUp: ({ editor }) => {
        if (hasModalOpen()) return false

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
        if (hasModalOpen()) return false

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
        if (hasModalOpen()) return false

        editor.view.dom.dispatchEvent(new CustomEvent('enter-as-block', {
          bubbles: true,
          detail: { type: 'exitEdit' }
        }))
        return true
      },

      'Mod-s': ({ editor }) => {
        // 保存快捷键不受模态层影响
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
