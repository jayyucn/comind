import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

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
  query: string
}

export interface WikiLinkAtCursorResult {
  found: boolean
  range: { from: number; to: number } | null
  query: string
}

let menuIsOpen = false
let selectingFromMenu = false
let currentQuery = ''

export function notifyWikiLinkMenuSelect() {
  selectingFromMenu = true
  setTimeout(() => {
    selectingFromMenu = false
  }, 100)
}

export function closeWikiLinkMenuByEditor() {
  menuIsOpen = false
  currentQuery = ''
}

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

  return result
}

function closeWikiLinkMenu(view: any) {
  const query = currentQuery
  menuIsOpen = false
  currentQuery = ''
  const closeEvent = new CustomEvent<WikiLinkCloseEvent>('wiki-link-close', {
    bubbles: true,
    detail: { reason: 'cursor-move', query }
  })
  view.dom.dispatchEvent(closeEvent)
}

function triggerWikiLinkMenu(
  view: any,
  position: number,
  range: { from: number; to: number },
  query: string
) {
  menuIsOpen = true
  currentQuery = query

  const triggerEvent = new CustomEvent<WikiLinkTriggerEvent>('wiki-link-trigger', {
    bubbles: true,
    detail: { view, position, range, query }
  })
  view.dom.dispatchEvent(triggerEvent)
}

function handleWikiLinkDetection(view: any) {
  const { state } = view
  const cursorPos = state.selection.from
  const result = findWikiLinkAtCursor(state.doc, cursorPos)

  if (result.found && result.range) {
    if (!menuIsOpen) {
      triggerWikiLinkMenu(view, cursorPos, result.range, result.query)
    } else {
      currentQuery = result.query
      const updateEvent = new CustomEvent<WikiLinkUpdateEvent>('wiki-link-update', {
        bubbles: true,
        detail: { query: result.query }
      })
      view.dom.dispatchEvent(updateEvent)
    }
  } else if (menuIsOpen) {
    closeWikiLinkMenu(view)
  }
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
              const $pos = state.doc.resolve(state.selection.from)
              const textBefore = $pos.nodeBefore?.text || ''

              if (textBefore.endsWith('[')) {
                setTimeout(() => {
                  handleWikiLinkDetection(view)
                }, 0)
              }
            }

            if (menuIsOpen) {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                closeWikiLinkMenu(view)
                return false
              }

              if (event.key === 'Backspace') {
                setTimeout(() => {
                  handleWikiLinkDetection(view)
                }, 0)
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
              handleWikiLinkDetection(view)
            }, 0)

            return false
          },
          handleDOMEvents: {
            compositionend(view) {
              if (selectingFromMenu) return false

              setTimeout(() => {
                handleWikiLinkDetection(view)
              }, 0)

              return false
            }
          },
          handleClick(view, pos, _event) {
            if (!menuIsOpen) return false

            const editorContainer = view.dom.closest('[contenteditable="true"]')
            const isInEditor = editorContainer !== null

            if (!isInEditor) {
              closeWikiLinkMenu(view)
              return false
            }

            const result = findWikiLinkAtCursor(view.state.doc, pos)
            if (!result.found) {
              closeWikiLinkMenu(view)
            }
            return false
          }
        },
        view(_view) {
          return {
            update(view, prevState) {
              if (view.state.doc === prevState.doc) return
              // 文档结构变化时（如 Backspace 删除 '^'）只关闭菜单，
              // 不主动弹菜单 — 弹菜单由 handleTextInput / '[' 键 /
              // compositionend 等用户主动输入事件触发。
              // 这样可以避免关系菜单关闭后 PageLinkMenu 又弹出的问题。
              if (menuIsOpen) {
                const result = findWikiLinkAtCursor(view.state.doc, view.state.selection.from)
                if (!result.found) {
                  closeWikiLinkMenu(view)
                }
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
