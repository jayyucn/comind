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

function dispatchWikiLinkUpdateEvent(view: any) {
  setTimeout(() => {
    const { state } = view
    const cursorPos = state.selection.from
    const result = findWikiLinkAtCursor(state.doc, cursorPos)
    const updateEvent = new CustomEvent<WikiLinkUpdateEvent>('wiki-link-update', {
      bubbles: true,
      detail: { query: result.query }
    })
    view.dom.dispatchEvent(updateEvent)
  }, 0)
}

export interface WikiLinkCloseEvent {
  reason: 'cursor-move' | 'doc-change'
}

export interface WikiLinkAtCursorResult {
  found: boolean
  range: { from: number; to: number } | null
  query: string
}

let menuIsOpen = false
let selectingFromMenu = false

export function notifyWikiLinkMenuSelect() {
  selectingFromMenu = true
  setTimeout(() => {
    selectingFromMenu = false
  }, 100)
}

/**
 * 在文档中查找光标位置处的 Wiki 链接
 * 支持：[[page]]、[[page|display]]、[[page（未闭合）
 */
export function findWikiLinkAtCursor(
  doc: any,
  pos: number
): WikiLinkAtCursorResult {
  const linkRegex = /\[\[([^\]|]*)(?:\|[^\]]*)?\]\]|\[\[([^\]|]*)(?:\|[^\]]*)?/g
  let foundMatch = false

  let result: WikiLinkAtCursorResult = { found: false, range: null, query: '' }

  doc.descendants((node: any, nodePos: number) => {
    if (!node.isText || foundMatch) return

    const text = node.text || ''
    let match
    while ((match = linkRegex.exec(text)) !== null) {
      const start = nodePos + match.index
      const end = nodePos + match.index + match[0].length
      const query = match[1] ?? match[2] ?? ''

      if (pos > start && pos <= end) {
        result = {
          found: true,
          range: { from: start, to: end },
          query
        }
        foundMatch = true
        break
      }
    }
  })

  linkRegex.lastIndex = 0
  return result
}

/**
 * 统一触发 WikiLink 菜单显示
 */
function triggerWikiLinkMenu(
  view: any,
  position: number,
  range: { from: number; to: number },
  query: string
) {
  menuIsOpen = true

  const triggerEvent = new CustomEvent<WikiLinkTriggerEvent>('wiki-link-trigger', {
    bubbles: true,
    detail: { view, position, range, query }
  })
  view.dom.dispatchEvent(triggerEvent)
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
                setTimeout(() => {
                  const { state } = view
                  const pos = state.selection.from
                  let from = pos - 2
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
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                menuIsOpen = false
                const closeEvent = new CustomEvent<WikiLinkCloseEvent>('wiki-link-close', {
                  bubbles: true,
                  detail: { reason: 'cursor-move' }
                })
                view.dom.dispatchEvent(closeEvent)
                return true
              }

              if (event.key === 'Backspace') {
                dispatchWikiLinkUpdateEvent(view)
              }

              if (event.key === 'Enter' || event.key === 'Escape' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault()
                event.stopPropagation()
                if (event.key === 'Enter' || event.key === 'Escape') {
                  menuIsOpen = false
                }
                const customEvent = new CustomEvent(`wiki-link-menu-${event.key.toLowerCase()}`, {
                  bubbles: true,
                  detail: {}
                })
                view.dom.dispatchEvent(customEvent)
                return true
              }
            }

            return false
          },
          handleTextInput(view, _from, _to, _text) {
            if (selectingFromMenu) return false

            setTimeout(() => {
              const { state } = view
              const cursorPos = state.selection.from
              const result = findWikiLinkAtCursor(state.doc, cursorPos)

              if (result.found && result.range) {
                if (!menuIsOpen) {
                  triggerWikiLinkMenu(view, cursorPos, result.range, result.query)
                } else {
                  const updateEvent = new CustomEvent<WikiLinkUpdateEvent>('wiki-link-update', {
                    bubbles: true,
                    detail: { query: result.query }
                  })
                  view.dom.dispatchEvent(updateEvent)
                }
              }
            }, 0)

            return false
          },
          handleDOMEvents: {
            compositionend(view) {
              if (selectingFromMenu) return false

              setTimeout(() => {
                const { state } = view
                const cursorPos = state.selection.from
                const result = findWikiLinkAtCursor(state.doc, cursorPos)

                if (result.found && result.range) {
                  if (!menuIsOpen) {
                    triggerWikiLinkMenu(view, cursorPos, result.range, result.query)
                  } else {
                    const updateEvent = new CustomEvent<WikiLinkUpdateEvent>('wiki-link-update', {
                      bubbles: true,
                      detail: { query: result.query }
                    })
                    view.dom.dispatchEvent(updateEvent)
                  }
                }
              }, 0)

              return false
            }
          },
          handleClick(_view, _pos, _event) {
            const editorContainer = _view.dom.closest('[contenteditable="true"]')
            const isInEditor = editorContainer !== null

            if (!isInEditor && menuIsOpen) {
              menuIsOpen = false
              const closeEvent = new CustomEvent<WikiLinkCloseEvent>('wiki-link-close', {
                bubbles: true,
                detail: { reason: 'cursor-move' }
              })
              _view.dom.dispatchEvent(closeEvent)
            }
            return false
          }
        },
        view(_view) {
          return {
            update(view, prevState) {
              if (view.state.doc === prevState.doc) return

              const { state } = view
              const cursorPos = state.selection.from
              const result = findWikiLinkAtCursor(state.doc, cursorPos)

              if (result.found && result.range) {
                if (!menuIsOpen) {
                  triggerWikiLinkMenu(view, cursorPos, result.range, result.query)
                } else {
                  const updateEvent = new CustomEvent<WikiLinkUpdateEvent>('wiki-link-update', {
                    bubbles: true,
                    detail: { query: result.query }
                  })
                  view.dom.dispatchEvent(updateEvent)
                }
              }
            },
            destroy() {
              setTimeout(() => {
                menuIsOpen = false
              }, 0)
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
