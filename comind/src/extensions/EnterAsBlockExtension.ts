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

      'Shift-Enter': ({ editor }) => {
        return editor.commands.setHardBreak()
      },

      Backspace: ({ editor }) => {
        // 检查是否有斜杠命令菜单或其他模态框打开
        if (hasModalOpen()) return false

        const { $from, from, to} = editor.state.selection
        const content = editor.getText()

        if (content.length === 0 || ($from.parentOffset === 0 && from === to)) {
          // 先尝试删除 between 属性（无论内容是否为空）
          const deleteEvent = new CustomEvent('delete-between-property', {
            bubbles: true,
            cancelable: true,
            detail: {}
          })
          editor.view.dom.dispatchEvent(deleteEvent)

          // 如果事件被取消，说明成功删除了属性，不执行其他操作
          if (deleteEvent.defaultPrevented) {
            return true
          }

          // 如果内容为空，执行 delete，否则执行 merge
          if (content.length === 0) {
            editor.view.dom.dispatchEvent(new CustomEvent('enter-as-block', {
              bubbles: true,
              detail: { type: 'delete' }
            }))
          } else {
            editor.view.dom.dispatchEvent(new CustomEvent('enter-as-block', {
              bubbles: true,
              detail: { type: 'merge' }
            }))
          }
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

      'Mod-1': ({ editor }) => {
        if (hasModalOpen()) return false
        applyHeading(editor, 1)
        return true
      },

      'Mod-2': ({ editor }) => {
        if (hasModalOpen()) return false
        applyHeading(editor, 2)
        return true
      },

      'Mod-3': ({ editor }) => {
        if (hasModalOpen()) return false
        applyHeading(editor, 3)
        return true
      },

      'Mod-4': ({ editor }) => {
        if (hasModalOpen()) return false
        applyHeading(editor, 4)
        return true
      },

      'Mod-5': ({ editor }) => {
        if (hasModalOpen()) return false
        applyHeading(editor, 5)
        return true
      },

      'Mod-6': ({ editor }) => {
        if (hasModalOpen()) return false
        applyHeading(editor, 6)
        return true
      },
    }
  }
})

function applyHeading(editor: any, level: number) {
  const content = editor.getText()
  const headingPrefix = '#'.repeat(level) + ' '

  const headingMatch = content.match(/^#{1,6}\s+/)
  if (headingMatch) {
    const newContent = content.replace(/^#{1,6}\s+/, headingPrefix)
    editor.chain().setContent(newContent).focus().run()
  } else {
    editor.chain().setContent(headingPrefix + content).focus().run()
  }
}

export default EnterAsBlockExtension
