import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
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

const DATE_REF_PLUGIN_KEY = new PluginKey('dateRef')

export const DateRefExtension = Extension.create({
  name: 'dateRef',

  addProseMirrorPlugins() {
    // 点击 chip 前记录选区，handleClick 触发动作后还原，避免浏览器在点击点放置的
    // 原生光标卡进 chip 内部（chip 是原子单元，落光标会让用户敲坏序列化文本）。
    // 关键：mousedown 绝不能 preventDefault / return true —— PM 的 handleClick 由
    // mousedown 阶段创建的 LeftMouseDown 在 mouseup 触发，跳过它点击行为会整体失效。
    let preClickSel: { from: number; to: number } | null = null

    return [
      new Plugin({
        key: DATE_REF_PLUGIN_KEY,

        props: {
          decorations(state: EditorState) {
            const decorations: Decoration[] = []
            buildDecorations(state.doc, decorations)
            return DecorationSet.create(state.doc, decorations)
          },

          // 仅记录点击前选区，不拦截 —— 让 PM 正常走 mousedown→mouseup→handleClick，
          // 点击行为（开面板）与渲染态一致。
          handleDOMEvents: {
            mousedown(view: EditorView, event: MouseEvent) {
              const target = event.target as HTMLElement | null
              if (target && target.closest && target.closest('.date-ref')) {
                preClickSel = { from: view.state.selection.from, to: view.state.selection.to }
              }
              return false
            },
          },

          handleClick(view: EditorView, pos: number, event: MouseEvent) {
            const target = event.target as HTMLElement
            if (!target.classList.contains('date-ref')) return false

            // 单元范围从 doc 现场扫描（与装饰、键盘原语共用 scanDateRefMatches）：
            // 插件 state 恒为 DecorationSet.empty（decorations prop 从不写回插件
            // state，getState 恒空）——曾据此取范围致 from/to 退化为光标位，
            // 面板确认时 deleteRange 空操作 + 原地插入，文档被写坏。
            const match = scanDateRefMatches(view.state.doc).find(
              m => pos >= m.from && pos <= m.to
            )
            const from = match?.from ?? pos
            const to = match?.to ?? pos

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

            // 还原选区：点击 chip 不应把光标落进 chip 内部。优先回到点击前位置；
            // 无记录则退到单元右侧边界（保证光标在 chip 之外）。
            const restore = preClickSel ?? { from: to, to }
            view.dispatch(
              view.state.tr.setSelection(
                TextSelection.create(view.state.doc, restore.from, restore.to)
              )
            )
            preClickSel = null
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
