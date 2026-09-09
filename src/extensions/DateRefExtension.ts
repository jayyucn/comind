import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { DateRefKind, RecurrenceRule } from '../utils/date-ref'
import { DATE_REF_AT_REGEX, normalizeRecurrence } from '../utils/date-ref'

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
            // 有选区（非光标态）时不拦截，交给默认删除逻辑处理选区
            const { state } = view
            if (!state.selection.empty) return false

            const pos = state.selection.from

            // ⚠️ 不能依赖 DATE_REF_PLUGIN_KEY.getState() 拿装饰：插件的 state.init 只返回
            // DecorationSet.empty，decorations prop 动态构建的装饰集从不写回插件状态，
            // getState 恒为空 → 整单元删除曾长期失效（死代码）。改为直接对当前 doc 重建
            // 装饰（与 decorations prop 共用 buildDecorations，保证同源同步）。
            const decorations: Decoration[] = []
            buildDecorations(state.doc, decorations)

            // Backspace: 仅当光标精确位于 dateRef/schedule/deadline 单元右侧（紧随其后）时，
            // 整单元删除；其他位置（单元左侧、单元内部、普通文本）保持正常逐字符删除
            if (event.key === 'Backspace') {
              for (const deco of decorations) {
                // 光标在单元右边界（to 为开区间终点）→ 删除整个单元
                if (pos === deco.to) {
                  event.preventDefault()
                  view.dispatch(state.tr.delete(deco.from, deco.to))
                  return true
                }
              }
            }

            // Delete 键: 光标恰在 dateRef 单元左侧 → 删除整个单元（向右删除的镜像语义）
            if (event.key === 'Delete') {
              for (const deco of decorations) {
                if (pos === deco.from) {
                  event.preventDefault()
                  view.dispatch(state.tr.delete(deco.from, deco.to))
                  return true
                }
              }
            }

            // 方向键: 光标贴单元左缘按 →（右）应整体跨过单元跳到右缘，贴右缘按 ←（左）
            // 跳到左缘——光标不进入单元内部，把 dateRef/schedule/deadline 当整体词移动。
            // 仅拦截无修饰键的光标态：ctrl/meta/alt/shift 组合交给默认（整词/选区扩展），
            // 有选区（非光标态）也放行。
            if (
              (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
              !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
            ) {
              // ←：跨过「右缘 == pos」的单元（它紧贴光标左侧）；→：跨过「左缘 == pos」的单元
              const unit = decorations.find(deco =>
                event.key === 'ArrowLeft' ? deco.to === pos : deco.from === pos
              )
              if (unit) {
                event.preventDefault()
                const target = event.key === 'ArrowLeft' ? unit.from : unit.to
                view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, target)))
                return true
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
