import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { DATE_REF_REGEX, formatDateRefDisplay, normalizeRecurrence } from '../utils/date-ref'
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
}

function buildDecorations(doc: any, decorations: Decoration[]) {
  doc.descendants((node: any, pos: number) => {
    if (!node.isText) return
    const text = node.text || ''
    const re = new RegExp(DATE_REF_REGEX.source, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const start = pos + m.index
      const end = start + m[0].length
      const kind = m[1] as DateRefKind
      const iso = m[2]
      const recurrence = normalizeRecurrence(m[3])

      decorations.push(
        Decoration.inline(start, end, {
          class: 'date-ref',
          'data-kind': kind,
          'data-iso': iso,
          'data-recurrence': recurrence,
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
