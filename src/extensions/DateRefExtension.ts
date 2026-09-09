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

            // 语义（2026-09-09）：date-ref 两侧的 pad 空格属于单元的一部分，单元在交互上
            // 是「整体区间」[L, R)：L = from - (左邻空格?1:0)，R = to + (右邻空格?1:0)。
            // 删除与方向键跨越都按整体区间处理；装饰 span 仍只覆盖 [from, to)（视觉不含空格）。
            const unitBounds = (from: number, to: number) => {
              const size = state.doc.content.size
              const leftPad = from > 0 && state.doc.textBetween(from - 1, from, '\n', ' ') === ' '
              const rightPad = to < size && state.doc.textBetween(to, to + 1, '\n', ' ') === ' '
              return { from, to, leftPad, rightPad, L: leftPad ? from - 1 : from, R: rightPad ? to + 1 : to }
            }

            // 删除整体区间并处理分隔：右 pad 随单元删；左 pad 仅在「删后同块右侧无内容（行尾）」
            // 时连带删（并把行尾多余空白一并清掉），避免悬挂空格/双空格；中间位置保留左 pad 作分隔。
            const deleteUnit = (from: number, to: number) => {
              const u = unitBounds(from, to)
              const blockEnd = state.doc.resolve(u.R).end()
              const rest = u.R < blockEnd ? state.doc.textBetween(u.R, blockEnd, '\n', ' ') : ''
              const restHasContent = rest.trim().length > 0
              const delFrom = restHasContent ? u.from : u.leftPad ? u.L : u.from
              const delTo = restHasContent ? u.R : blockEnd
              let tr = state.tr.delete(delFrom, delTo)
              tr = tr.setSelection(TextSelection.create(tr.doc, delFrom))
              view.dispatch(tr)
            }

            // Backspace/Delete：光标位于整体区间两侧的 pad 边界带时整单元删除。
            // Backspace 右缘带 = [to, R]（含站在右 pad 空格上）；Delete 左缘带 = [L, from]。
            // 单元内部（from..to 之间）与其他位置保持正常逐字符删除。
            if (event.key === 'Backspace' || event.key === 'Delete') {
              const deletingLeft = event.key === 'Backspace'
              for (const deco of decorations) {
                const u = unitBounds(deco.from, deco.to)
                const inZone = deletingLeft
                  ? pos >= deco.to && pos <= u.R
                  : pos >= u.L && pos <= deco.from
                if (!inZone) continue
                event.preventDefault()
                deleteUnit(deco.from, deco.to)
                return true
              }
            }

            // 方向键: 光标在整体区间左缘带 [L, from] 按 → 整体跨到 R（右 pad 后）；
            // 在右缘带 [to, R] 按 ← 整体跨回 L（左 pad 前）——pad 空格随单元一起跨过，
            // 光标不进入单元与 pad 之间。仅拦截无修饰键的光标态：ctrl/meta/alt/shift
            // 组合交给默认（整词/选区扩展），有选区（非光标态）也放行。
            if (
              (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
              !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
            ) {
              for (const deco of decorations) {
                const u = unitBounds(deco.from, deco.to)
                const inZone = event.key === 'ArrowLeft'
                  ? pos >= deco.to && pos <= u.R
                  : pos >= u.L && pos <= deco.from
                if (!inZone) continue
                event.preventDefault()
                const target = event.key === 'ArrowLeft' ? u.L : u.R
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
