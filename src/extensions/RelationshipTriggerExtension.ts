import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export interface RelationshipTriggerEvent {
  view: any
  position: number
  // 包含 '((type))' 段的范围
  range: { from: number; to: number }
  relationshipType: string
}

export interface RelationshipCloseEvent {
  reason: 'cursor-move' | 'doc-change' | 'escape'
}

let menuIsOpen = false
let selectingFromMenu = false

export function notifyRelationshipMenuSelect() {
  selectingFromMenu = true
  setTimeout(() => {
    selectingFromMenu = false
  }, 100)
}

export function closeRelationshipMenuByEditor() {
  menuIsOpen = false
}

export interface RelationshipAtCaretResult {
  found: boolean
  range: { from: number; to: number } | null
  relationshipType: string
}

/**
 * 在光标前检测 '((type))' 或 '（（type））' 模式。
 *
 * 新格式：((type))[[X]] 或 （（type））[[X]]
 *
 * 用户输入第一个 '(' 后，我们检测：
 * 1) 光标前是否紧跟着另一个 '(' 或 '（'
 * 2) 如果是 '(((' 或 '（（'，则触发菜单
 *
 * 触发后，用户选择关系类型，插入 '((type))'，然后用户继续输入 '[[' 触发 wiki link
 */
export function findRelationshipAtCaret(
  doc: any,
  pos: number
): RelationshipAtCaretResult {
  // 用 doc.textBetween 取 cursor 前的纯文本（不包含 block 边界）
  const text = doc.textBetween(0, pos, '\n', '\n')

  // 检测 '(( ' 或 '（（' 模式（中文括号或英文括号）
  // 需要至少 3 个字符：(( + 一个待输入的字符位置
  if (text.length < 2) {
    return { found: false, range: null, relationshipType: '' }
  }

  // 检查末尾两个字符是否匹配 (( 或 （（
  const lastTwoChars = text.slice(-2)

  // 英文括号 (( 或 中文括号 （（
  const isDoubleParen = lastTwoChars === '((' || lastTwoChars === '（（'

  if (!isDoubleParen) {
    return { found: false, range: null, relationshipType: '' }
  }

  // textStart 是 doc 中第一段 text 节点的起始位置（doc position）
  const textStart = pos - text.length

  // range 从第一个 ( 的位置开始，到当前 cursor 位置
  const rangeFromDocPos = textStart + text.length - 2
  const rangeToDocPos = pos

  return {
    found: true,
    range: { from: rangeFromDocPos, to: rangeToDocPos },
    relationshipType: ''
  }
}

function closeRelationshipMenuByExtension(view: any, reason: 'cursor-move' | 'doc-change' | 'escape' = 'doc-change') {
  if (!menuIsOpen) return
  menuIsOpen = false
  const closeEvent = new CustomEvent<RelationshipCloseEvent>('relationship-close', {
    bubbles: true,
    detail: { reason }
  })
  view.dom.dispatchEvent(closeEvent)
}

function triggerRelationshipMenu(
  view: any,
  position: number,
  range: { from: number; to: number },
  relationshipType: string
) {
  menuIsOpen = true
  const event = new CustomEvent<RelationshipTriggerEvent>('relationship-trigger', {
    bubbles: true,
    detail: { view, position, range, relationshipType }
  })
  view.dom.dispatchEvent(event)
}

function handleRelationshipDetection(view: any) {
  const { state } = view
  const cursorPos = state.selection.from
  const result = findRelationshipAtCaret(state.doc, cursorPos)
  if (result.found && result.range) {
    if (!menuIsOpen) {
      triggerRelationshipMenu(view, cursorPos, result.range, result.relationshipType)
    }
  }
}

export const RelationshipTriggerExtension = Extension.create({
  name: 'relationshipTrigger',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('relationshipTrigger'),
        props: {
          handleKeyDown: (view, event) => {
            // 检测 ( 或 （ 键，检查前一个字符是否也是括号
            if (event.key === '(' || event.key === '（') {
              const { state } = view
              const $pos = state.doc.resolve(state.selection.from)
              const textBefore = $pos.nodeBefore?.text || ''

              const lastChar = textBefore.slice(-1)
              const isPrevParen = lastChar === '(' || lastChar === '（'

              if (isPrevParen) {
                setTimeout(() => {
                  handleRelationshipDetection(view)
                }, 0)
              }
            }

            if (!menuIsOpen) return false

            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              closeRelationshipMenuByExtension(view, 'escape')
              return true
            }

            if (event.key === 'Enter') {
              // 选中和关闭由 menu 自己处理（onSelect 走 select()）
              event.preventDefault()
              event.stopPropagation()
              return true
            }

            if (event.key === 'Backspace') {
              setTimeout(() => {
                const r = findRelationshipAtCaret(view.state.doc, view.state.selection.from)
                if (!r.found && menuIsOpen) {
                  closeRelationshipMenuByExtension(view, 'doc-change')
                } else if (r.found) {
                  handleRelationshipDetection(view)
                }
              }, 0)
            }

            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              setTimeout(() => {
                const r = findRelationshipAtCaret(view.state.doc, view.state.selection.from)
                if (!r.found && menuIsOpen) {
                  closeRelationshipMenuByExtension(view, 'doc-change')
                } else if (r.found) {
                  handleRelationshipDetection(view)
                }
              }, 0)
            }

            return false
          },
          handleTextInput(view, _from, _to, _text) {
            if (selectingFromMenu) return false

            // 对所有文本输入都检测，确保自动补全等场景下也能正确触发
            setTimeout(() => {
              handleRelationshipDetection(view)
            }, 0)

            return false
          },
        },
        view(_view: any) {
          return {
            update(view: any, prevState: any) {
              if (view.state.doc === prevState.doc) return
              if (!menuIsOpen) return
              // 文档结构变化时重新检测
              const r = findRelationshipAtCaret(view.state.doc, view.state.selection.from)
              if (!r.found && menuIsOpen) {
                closeRelationshipMenuByExtension(view, 'doc-change')
              }
            },
            destroy() {
              menuIsOpen = false
            }
          }
        }
      })
    ]
  }
})