import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { DateRefKind } from '../utils/date-ref'

export interface DateRefTriggerEvent {
  view: any
  /** 光标在触发符后的位置 */
  position: number
  /** 触发符的完整范围（插入后文档坐标） */
  range: { from: number; to: number }
  /** 推断的 kind */
  kind: DateRefKind
}

export interface DateRefKindSelectEvent {
  view: any
  /** @ 符号的位置 */
  range: { from: number; to: number }
  /** 屏幕坐标 */
  coords: { left: number; top: number; bottom: number }
}

let menuIsOpen = false

export function closeDateRefMenu() {
  menuIsOpen = false
}

/**
 * 检测光标前是否有 @ 模式（新格式触发器）
 */
function findDateRefTrigger(doc: any, pos: number): {
  found: boolean
  from: number
  to: number
  kind: DateRefKind
} {
  let result = { found: false, from: 0, to: 0, kind: 'ref' as DateRefKind }

  doc.descendants((node: any, nodePos: number) => {
    if (!node.isText) return
    const text = node.text || ''
    const localPos = pos - nodePos
    if (localPos < 0 || localPos > text.length) return

    const searchStart = Math.max(0, localPos - 20)
    const searchText = text.slice(searchStart, localPos)

    // @ 后跟日期数字
    const atMatch = searchText.match(/@(\d{0,4}-?)$/)
    if (atMatch) {
      const triggerStart = nodePos + searchStart + atMatch.index!
      result = {
        found: true,
        from: triggerStart,
        to: pos,
        kind: 'ref',
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
            // 新格式触发器：输入 @
            if (event.key === '@') {
              // 延迟到 @ 插入后再检测，由 view.update 处理
              menuIsOpen = true
            }

            if (event.key === 'Escape' && menuIsOpen) {
              menuIsOpen = false
              view.dom.dispatchEvent(new CustomEvent('dateRefTriggerClose', { bubbles: true }))
              view.dom.dispatchEvent(new CustomEvent('dateRefKindSelectClose', { bubbles: true }))
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
                view.dom.dispatchEvent(new CustomEvent('dateRefKindSelectClose', { bubbles: true }))
              } else {
                // 输入 @ 后跟数字 → 显示 kind 选择下拉框
                // 只在 @ 后刚开始输入数字时显示选择器
                const text = view.state.doc.textBetween(result.from, result.to, ' ')
                if (text === '@') {
                  // 刚输入 @，还没有数字 — 显示 kind 选择器
                  const coords = view.coordsAtPos(result.to)
                  view.dom.dispatchEvent(new CustomEvent<DateRefKindSelectEvent>('dateRefKindSelect', {
                    bubbles: true,
                    detail: {
                      view,
                      range: { from: result.from, to: result.to },
                      coords: { left: coords.left, top: coords.top, bottom: coords.bottom },
                    },
                  }))
                } else {
                  // @ 后已有数字 — 直接打开 dateRef 面板（kind=ref）
                  const triggerEvent = new CustomEvent<DateRefTriggerEvent>('dateRefTrigger', {
                    bubbles: true,
                    detail: {
                      view,
                      position: result.to,
                      range: { from: result.from, to: result.to },
                      kind: result.kind,
                    },
                  })
                  view.dom.dispatchEvent(triggerEvent)
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
