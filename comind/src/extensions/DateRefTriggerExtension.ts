import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { DateRefKind } from '../utils/date-ref'

export interface DateRefTriggerEvent {
  view: any
  /** 光标在 {{ 后的位置 */
  position: number
  /** {{ 字符的完整范围（插入后文档坐标） */
  range: { from: number; to: number }
  /** 推断的 kind */
  kind: DateRefKind
}

let menuIsOpen = false

export function closeDateRefMenu() {
  menuIsOpen = false
}

/**
 * 检测光标前是否有 {{ 模式，并推断 kind
 * 用于 view.update() 清理：文档变化后重新验证
 */
function findDateRefTrigger(doc: any, pos: number): {
  found: boolean
  from: number
  to: number
  kind: DateRefKind
} {
  let result = { found: false, from: 0, to: 0, kind: 'schedule' as DateRefKind }

  doc.descendants((node: any, nodePos: number) => {
    if (!node.isText) return
    const text = node.text || ''
    const localPos = pos - nodePos
    if (localPos < 0 || localPos > text.length) return

    const searchStart = Math.max(0, localPos - 20)
    const searchText = text.slice(searchStart, localPos)
    const triggerMatch = searchText.match(/\{\{(\w*)$/)

    if (triggerMatch) {
      const triggerStart = nodePos + searchStart + triggerMatch.index!
      result = {
        found: true,
        from: triggerStart,
        to: pos,
        kind: triggerMatch[1] === 'deadline' ? 'deadline' : 'schedule',
      }
      return false
    }
  })

  return result
}

export const DateRefTriggerExtension = Extension.create({
  name: 'dateRefTrigger',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('dateRefTrigger'),
        props: {
          handleKeyDown(view, event) {
            if (event.key === '{') {
              const { state } = view
              const cursorPos = state.selection.from
              const $pos = state.doc.resolve(cursorPos)
              const textBefore = $pos.nodeBefore?.text || ''

              if (textBefore.endsWith('{')) {
                // {{ 已插入：from = cursorPos-1, to = cursorPos+1
                const rangeFrom = cursorPos - 1
                const rangeTo = cursorPos + 1
                menuIsOpen = true

                const triggerEvent = new CustomEvent<DateRefTriggerEvent>('dateRefTrigger', {
                  bubbles: true,
                  detail: {
                    view,
                    position: rangeTo,
                    range: { from: rangeFrom, to: rangeTo },
                    kind: 'schedule',
                  },
                })
                view.dom.dispatchEvent(triggerEvent)
              }
            }

            if (event.key === 'Escape' && menuIsOpen) {
              menuIsOpen = false
              return true
            }

            return false
          },
        },

        view() {
          return {
            update(view, prevState) {
              if (!menuIsOpen) return
              if (view.state.doc === prevState.doc) return
              const result = findDateRefTrigger(view.state.doc, view.state.selection.from)
              if (!result.found) {
                menuIsOpen = false
                view.dom.dispatchEvent(new CustomEvent('dateRefTriggerClose', { bubbles: true }))
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
