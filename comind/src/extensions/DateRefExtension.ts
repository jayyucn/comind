import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { DATE_REF_AT_REGEX, normalizeRecurrence } from '../utils/date-ref'
import type { DateRefKind, RecurrenceRule } from '../utils/date-ref'

export const DATE_REF_CLICK_EVENT = 'dateRefClick'

export interface DateRefClickPayload {
  /** ProseMirror 文档坐标 */
  from: number
  to: number
  blockId: string
  kind: DateRefKind
  iso: string
  recurrence: RecurrenceRule
  leadMinutes: number
}

function buildDecorations(doc: any, decorations: Decoration[]) {
  doc.descendants((node: any, pos: number) => {
    if (!node.isText) return
    const text = node.text || ''

    // @ISO[emoji][|params]
    const re = new RegExp(DATE_REF_AT_REGEX.source, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const start = pos + m.index
      const end = start + m[0].length
      const iso = m[1]
      const emoji = m[2]
      const kind: DateRefKind = emoji
        ? (emoji === '📅' ? 'schedule' : emoji === '⏰' ? 'deadline' : 'ref')
        : 'ref'
      const recurrence = normalizeRecurrence(m[3])
      const leadMinutes = m[4] ? parseInt(m[4], 10) || 0 : 0

      decorations.push(
        Decoration.inline(start, end, {
          class: 'date-ref',
          'data-kind': kind,
          'data-iso': iso,
          'data-recurrence': recurrence,
          'data-lead-minutes': leadMinutes.toString(),
        })
      )
    }
  })
}

/** 在 decoration set 中查找 clickPos 落在哪个 decoration 内，返回精确 [from, to] */
function findDecorationRange(
  decorationSet: DecorationSet,
  clickPos: number
): { from: number; to: number } | null {
  for (const decoration of decorationSet.find()) {
    if (decoration.from <= clickPos && clickPos <= decoration.to) {
      return { from: decoration.from, to: decoration.to }
    }
  }
  return null
}

const DATE_REF_PLUGIN_KEY = new PluginKey('dateRef')

export const DateRefExtension = Extension.create({
  name: 'dateRef',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: DATE_REF_PLUGIN_KEY,

        props: {
          decorations(state: any) {
            const decorations: Decoration[] = []
            buildDecorations(state.doc, decorations)
            return DecorationSet.create(state.doc, decorations)
          },

          handleClick(view: any, pos: number, event: MouseEvent) {
            const target = event.target as HTMLElement
            if (!target.classList.contains('date-ref')) return false

            const pluginState = DATE_REF_PLUGIN_KEY.getState(view.state) as DecorationSet | undefined
            const range = pluginState ? findDecorationRange(pluginState, pos) : null
            const from = range?.from ?? pos
            const to = range?.to ?? pos

            const payload: DateRefClickPayload = {
              from,
              to,
              blockId: '',
              kind: target.dataset.kind as DateRefKind,
              iso: target.dataset.iso ?? '',
              recurrence: normalizeRecurrence(target.dataset.recurrence),
              leadMinutes: parseInt(target.dataset.leadMinutes || '0', 10) || 0,
            }

            target.dispatchEvent(
              new CustomEvent(DATE_REF_CLICK_EVENT, {
                bubbles: true,
                composed: true,
                detail: payload,
              })
            )
            return true
          },

          handleKeyDown(view: any, event: KeyboardEvent) {
            // Backspace: 如果光标紧贴在 dateRef 装饰右侧，删除整个 dateRef
            if (event.key === 'Backspace') {
              const { state } = view
              const pos = state.selection.from
              const pluginState = DATE_REF_PLUGIN_KEY.getState(state) as DecorationSet | undefined
              if (!pluginState) return false

              // 查找光标位置紧邻的 dateRef 装饰
              const decos = pluginState.find()
              for (const deco of decos) {
                // 光标在装饰末尾 → 删除整个装饰范围
                if (pos === deco.to) {
                  event.preventDefault()
                  view.dispatch(state.tr.delete(deco.from, deco.to))
                  return true
                }
                // 光标在装饰开头 → 删除整个装饰范围
                if (pos === deco.from && pos > 0) {
                  event.preventDefault()
                  view.dispatch(state.tr.delete(deco.from, deco.to))
                  return true
                }
                // 光标在装饰内部 → 删除整个装饰范围
                if (pos > deco.from && pos < deco.to) {
                  event.preventDefault()
                  view.dispatch(state.tr.delete(deco.from, deco.to))
                  return true
                }
              }
            }

            // Delete 键: 如果光标紧贴在 dateRef 装饰左侧，删除整个 dateRef
            if (event.key === 'Delete') {
              const { state } = view
              const pos = state.selection.from
              const pluginState = DATE_REF_PLUGIN_KEY.getState(state) as DecorationSet | undefined
              if (!pluginState) return false

              const decos = pluginState.find()
              for (const deco of decos) {
                if (pos === deco.from) {
                  event.preventDefault()
                  view.dispatch(state.tr.delete(deco.from, deco.to))
                  return true
                }
              }
            }

            return false
          },
        },

        state: {
          init() {
            return DecorationSet.empty
          },
          apply(tr, prev) {
            return prev.map(tr.mapping, tr.doc)
          },
        },
      }),
    ]
  },
})
