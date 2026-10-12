import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node } from '@tiptap/pm/model'
import type { EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type { DateRefKind, RecurrenceRule } from '../utils/date-ref'
import { DATE_REF_AT_REGEX, normalizeRecurrence } from '../utils/date-ref'
import { createInlineUnitKeyboardPlugin } from './inline-unit-keyboard'

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

interface DateRefMatch {
  from: number
  to: number
  iso: string
  emoji: string | undefined
  recurrence: string
  leadMinutes: number
}

/**
 * 全 doc 扫描 `@ISO[emoji][|params]` 匹配（装饰与键盘原语共用同一扫描，
 * 保证「视觉单元」与「交互单元」永远同源；各调用点自建正则对象防 lastIndex 互踩）。
 */
function scanDateRefMatches(doc: Node): DateRefMatch[] {
  const matches: DateRefMatch[] = []
  doc.descendants((node, pos: number) => {
    if (!node.isText) return
    const text = node.text || ''
    const re = new RegExp(DATE_REF_AT_REGEX.source, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      matches.push({
        from: pos + m.index,
        to: pos + m.index + m[0].length,
        iso: m[1],
        emoji: m[2],
        recurrence: m[3] ?? '',
        leadMinutes: m[4] ? parseInt(m[4], 10) || 0 : 0,
      })
    }
  })
  return matches
}

/** 键盘原子单元区间（供共享原语现场重建；不读插件 state —— getState 恒空） */
function findDateRefRanges(doc: Node) {
  return scanDateRefMatches(doc).map(m => ({ from: m.from, to: m.to }))
}

function buildDecorations(doc: Node, decorations: Decoration[]) {
  for (const match of scanDateRefMatches(doc)) {
    const kind: DateRefKind = match.emoji
      ? match.emoji === '📅' ? 'schedule' : match.emoji === '⏰' ? 'deadline' : 'ref'
      : 'ref'

    decorations.push(
      Decoration.inline(match.from, match.to, {
        class: 'date-ref',
        'data-kind': kind,
        'data-iso': match.iso,
        'data-recurrence': normalizeRecurrence(match.recurrence),
        'data-lead-minutes': match.leadMinutes.toString(),
      })
    )
  }
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
          decorations(state: EditorState) {
            const decorations: Decoration[] = []
            buildDecorations(state.doc, decorations)
            return DecorationSet.create(state.doc, decorations)
          },

          handleClick(view: EditorView, pos: number, event: MouseEvent) {
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

      // 键盘原子语义（整单元删除 / 方向键跨越）走共享原语 inline-unit-keyboard：
      // 与 #tag / [[wiki link]] 同一份口径，测试矩阵见 inline-unit-keyboard.test.ts。
      // Up/Down 不归此管（跨块列保持归 EnterAsBlockExtension）。
      createInlineUnitKeyboardPlugin({ key: 'dateRefKeyboard', findRanges: findDateRefRanges }),
    ]
  },
})
