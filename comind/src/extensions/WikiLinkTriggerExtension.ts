import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { DecorationSet } from '@tiptap/pm/view'

export interface WikiLinkTriggerEvent {
  view: any
  position: number
  range: { from: number; to: number }
  query: string
}

export interface WikiLinkUpdateEvent {
  query: string
}

export interface WikiLinkCloseEvent {
  reason: 'cursor-move' | 'doc-change'
}

let menuIsOpen = false
let selectingFromMenu = false

export function notifyWikiLinkMenuSelect() {
  selectingFromMenu = true
  setTimeout(() => {
    selectingFromMenu = false
  }, 100)
}

export const WikiLinkTriggerExtension = Extension.create({
  name: 'wikiLinkTrigger',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('wikiLinkTrigger'),
        props: {
          handleKeyDown: (view, event) => {
            if (event.key === '[') {
              const { state } = view
              const selection = state.selection
              const pos = selection.from
              
              const $pos = state.doc.resolve(pos)
              const textBefore = $pos.nodeBefore?.text || ''
              
              if (textBefore.endsWith('[')) {
                // 让字符正常插入，然后在下一个 tick 触发菜单
                setTimeout(() => {
                  const { state } = view
                  const pos = state.selection.from
                  let from = pos - 2 // 刚输入的第二个 [ 位置是 pos-1，所以整个 [[ 从 pos-2 开始
                  let to = pos
                  
                  if (pos < state.doc.content.size) {
                    const charAfter = state.doc.textBetween(pos, pos + 1)
                    if (charAfter === ']') {
                      to = pos + 1
                    }
                  }
                  
                  const textAtRange = state.doc.textBetween(from, to)
                  const queryMatch = textAtRange.match(/^\[\[(.*?)\]/)
                  const query = queryMatch ? queryMatch[1] : ''
                  
                  menuIsOpen = true
                  
                  const triggerEvent = new CustomEvent<WikiLinkTriggerEvent>('wiki-link-trigger', {
                    bubbles: true,
                    detail: { view, position: pos, range: { from, to }, query }
                  })
                  view.dom.dispatchEvent(triggerEvent)
                }, 0)
              }
            }
            
            if (menuIsOpen) {
              if (event.key === 'Enter' || event.key === 'Escape' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault()
                event.stopPropagation()
                
                const customEvent = new CustomEvent(`wiki-link-menu-${event.key.toLowerCase()}`, {
                  bubbles: true,
                  detail: {}
                })
                view.dom.dispatchEvent(customEvent)
                return true
              }
            }
            
            return false
          }
        },
        state: {
          init() {
            return DecorationSet.empty
          },
          apply(tr, prev) {
            return prev.map(tr.mapping, tr.doc)
          }
        },
        view(view) {
          let lastMenuOpened = false
          
          const handleInput = () => {
            if (selectingFromMenu) return
            
            const { state } = view
            const { selection } = state
            const { from } = selection

            if (!selection.empty) return

            // 匹配 [[...]] 或 [[...（未闭合）的模式
            const linkRegex = /\[\[([^\]]*)/g
            let foundMatch = false

            state.doc.descendants((node, pos) => {
              if (!node.isText || foundMatch) return

              const text = node.text || ''
              let match
              while ((match = linkRegex.exec(text)) !== null) {
                const start = pos + match.index
                const end = pos + match.index + match[0].length

                if (from > start && from <= end) {
                  const query = match[1] || ''
                  
                  const updateEvent = new CustomEvent<WikiLinkUpdateEvent>('wiki-link-update', {
                    bubbles: true,
                    detail: { query }
                  })
                  view.dom.dispatchEvent(updateEvent)
                  lastMenuOpened = true
                  foundMatch = true
                  break
                }
              }
            })

            if (!foundMatch && lastMenuOpened) {
              lastMenuOpened = false
              menuIsOpen = false
              const closeEvent = new CustomEvent<WikiLinkCloseEvent>('wiki-link-close', {
                bubbles: true,
                detail: { reason: 'doc-change' }
              })
              view.dom.dispatchEvent(closeEvent)
            }
          }

          return {
            update(view, prevState) {
              const { selection } = view.state
              const prevSelection = prevState.selection
              
              if (selection.from !== prevSelection.from || selection.to !== prevSelection.to) {
                const { from } = selection
                // 匹配 [[...]] 或 [[...（未闭合）的模式
                const linkRegex = /\[\[([^\]]*)/g
                let foundInLink = false

                view.state.doc.descendants((node, pos) => {
                  if (!node.isText || foundInLink) return

                  const text = node.text || ''
                  let match
                  while ((match = linkRegex.exec(text)) !== null) {
                    const start = pos + match.index
                    const end = pos + match.index + match[0].length

                    if (from > start && from <= end) {
                      foundInLink = true
                      break
                    }
                  }
                })

                if (!foundInLink && lastMenuOpened) {
                  lastMenuOpened = false
                  menuIsOpen = false
                  const closeEvent = new CustomEvent<WikiLinkCloseEvent>('wiki-link-close', {
                    bubbles: true,
                    detail: { reason: 'cursor-move' }
                  })
                  view.dom.dispatchEvent(closeEvent)
                }
              }
              
              if (view.state.doc !== prevState.doc) {
                handleInput()
              }
            },
            destroy() {
              view.dom.removeEventListener('input', handleInput)
            }
          }
        }
      })
    ]
  }
})

export function setMenuOpen(open: boolean) {
  menuIsOpen = open
}
