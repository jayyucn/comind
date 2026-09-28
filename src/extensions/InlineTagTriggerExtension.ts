import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Node } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'

export interface TagTriggerEvent {
  view: EditorView
  position: number
  range: { from: number; to: number }
  query: string
}

export interface TagUpdateEvent {
  query: string
}

export interface TagCloseEvent {
  reason: 'cursor-move' | 'doc-change'
  query: string
}

export interface TagAtCursorResult {
  found: boolean
  range: { from: number; to: number } | null
  query: string
}

// 与 useContentRenderer 的 TAG_TRIGGER_SOURCE 同款负向后顾排除集：
// / | > @ " [ —— 避免 #tag 与 wiki link / 关系 / 网址 互相污染。
const EXCLUDED_BEFORE_HASH = new Set(['/', '|', '>', '@', '"', '['])

let menuIsOpen = false
let selectingFromMenu = false
let currentQuery = ''

export function notifyTagMenuSelect() {
  selectingFromMenu = true
  setTimeout(() => {
    selectingFromMenu = false
  }, 100)
}

export function closeTagMenuByEditor() {
  menuIsOpen = false
  currentQuery = ''
}

/**
 * 在光标处反查 `#tag` token（含仅输入 `#` 时的空 query 情形）。
 * 与 InlineTagExtension 的装饰范围一致：从 `#` 到光标之间的合法 tag 字符。
 */
export function findTagAtCursor(doc: Node, pos: number): TagAtCursorResult {
  let result: TagAtCursorResult = { found: false, range: null, query: '' }

  doc.descendants((node, nodePos: number) => {
    if (!node.isText || result.found) return

    const text = node.text || ''
    // 从后往前找最近的 `#`，且 `#` 前字符不在排除集
    for (let i = text.length - 1; i >= 0; i--) {
      if (text[i] !== '#') continue
      const prev = i > 0 ? text[i - 1] : ''
      if (EXCLUDED_BEFORE_HASH.has(prev)) continue

      const start = nodePos + i
      // 向前扫描合法 tag 字符（`/` 仅允许出现在合法字符之后，避免 `#/`）
      let j = i + 1
      while (j < text.length) {
        const ch = text[j]
        const isValid =
          /[\p{L}\p{N}_]/u.test(ch) ||
          (ch === '/' && j > i + 1 && text[j - 1] !== '/')
        if (!isValid) break
        j++
      }
      const end = nodePos + j

      // 光标须落在 `#` 之后、token 末尾（含）之内
      if (pos > start && pos <= end) {
        result = {
          found: true,
          range: { from: start, to: end },
          query: text.slice(i + 1, pos - nodePos),
        }
        return false
      }
      // 命中 `#` 但光标已越过 token 末（如 `#fo ` 后），停止本节点扫描
      break
    }
  })

  return result
}

function closeTagMenu(view: EditorView) {
  const query = currentQuery
  menuIsOpen = false
  currentQuery = ''
  const closeEvent = new CustomEvent<TagCloseEvent>('tag-close', {
    bubbles: true,
    detail: { reason: 'cursor-move', query },
  })
  view.dom.dispatchEvent(closeEvent)
}

function triggerTagMenu(
  view: EditorView,
  position: number,
  range: { from: number; to: number },
  query: string
) {
  menuIsOpen = true
  currentQuery = query

  const triggerEvent = new CustomEvent<TagTriggerEvent>('tag-trigger', {
    bubbles: true,
    detail: { view, position, range, query },
  })
  view.dom.dispatchEvent(triggerEvent)
}

function handleTagDetection(view: EditorView) {
  const { state } = view
  const cursorPos = state.selection.from
  const result = findTagAtCursor(state.doc, cursorPos)

  if (result.found && result.range) {
    if (!menuIsOpen) {
      triggerTagMenu(view, cursorPos, result.range, result.query)
    } else {
      currentQuery = result.query
      const updateEvent = new CustomEvent<TagUpdateEvent>('tag-update', {
        bubbles: true,
        detail: { query: result.query },
      })
      view.dom.dispatchEvent(updateEvent)
    }
  } else if (menuIsOpen) {
    closeTagMenu(view)
  }
}

export const InlineTagTriggerExtension = Extension.create({
  name: 'inlineTagTrigger',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('inlineTagTrigger'),
        props: {
          handleKeyDown: (view, event) => {
            // IME 组合中不拦截，避免 Enter 确认候选词误触
            if (event.isComposing || event.keyCode === 229) {
              return false
            }

            if (menuIsOpen) {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                closeTagMenu(view)
                return false
              }

              if (event.key === 'Backspace') {
                setTimeout(() => {
                  handleTagDetection(view)
                }, 0)
              }

              if (
                event.key === 'Enter' ||
                event.key === 'Escape' ||
                event.key === 'ArrowUp' ||
                event.key === 'ArrowDown'
              ) {
                event.preventDefault()
                event.stopPropagation()
                if (event.key === 'Enter' || event.key === 'Escape') {
                  menuIsOpen = false
                }
                const customEvent = new CustomEvent(`tag-menu-${event.key.toLowerCase()}`, {
                  bubbles: true,
                  detail: {},
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
              handleTagDetection(view)
            }, 0)

            return false
          },
          handleDOMEvents: {
            compositionend(view) {
              if (selectingFromMenu) return false

              setTimeout(() => {
                handleTagDetection(view)
              }, 0)

              return false
            },
          },
          handleClick(view, pos, _event) {
            const editorContainer = view.dom.closest('[contenteditable="true"]')
            const isInEditor = editorContainer !== null

            if (!isInEditor) {
              if (menuIsOpen) closeTagMenu(view)
              return false
            }

            const result = findTagAtCursor(view.state.doc, pos)
            if (result.found && result.range) {
              if (!menuIsOpen) {
                // 鼠标点击进入 #tag token 也触发菜单（类比 [[page]] 的预期之外，
                // 但用户要求点击同样可触发；纯文本点击不会命中，故不会误开）
                triggerTagMenu(view, pos, result.range, result.query)
              } else {
                // 菜单已开：点击仍在 token 内 → 刷新 query；不重开避免闪烁
                currentQuery = result.query
                const updateEvent = new CustomEvent<TagUpdateEvent>('tag-update', {
                  bubbles: true,
                  detail: { query: result.query },
                })
                view.dom.dispatchEvent(updateEvent)
              }
            } else if (menuIsOpen) {
              closeTagMenu(view)
            }
            return false
          },
        },
        view(_view) {
          return {
            update(view, prevState) {
              if (view.state.doc === prevState.doc) return
              if (menuIsOpen) {
                const result = findTagAtCursor(view.state.doc, view.state.selection.from)
                if (!result.found) {
                  closeTagMenu(view)
                }
              }
            },
            destroy() {
              menuIsOpen = false
            },
          }
        },
      }),
    ]
  },
})
