import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export interface RelationshipTriggerEvent {
  view: any
  position: number
  // 包含完整 '[[X]]...^' 段的范围：BracketPair 自动闭合的 ']]' 也算在内
  range: { from: number; to: number }
  // wiki link ']]' 结束位置（紧跟 ']]' 之后），用于 onSelect 精确替换
  wikiEnd: number
  pageName: string
}

export interface RelationshipCloseEvent {
  reason: 'cursor-move' | 'doc-change' | 'escape'
}

let menuIsOpen = false
let selectingFromMenu = false

export function notifyRelationshipMenuSelect() {
  selectingFromMenu = true
  setTimeout(() => {
    selectingFromMenu = false
  }, 100)
}

export function closeRelationshipMenuByEditor() {
  menuIsOpen = false
}

export interface RelationshipAtCaretResult {
  found: boolean
  range: { from: number; to: number } | null
  wikiEnd: number | null
  pageName: string
}

/**
 * 在光标前检测 '[[X]]^' 模式。
 *
 * 关键约束：'^' 必须紧贴在 wiki link 闭合 ']]' 之后，中间不能有空格
 * 或其它字符。BracketPair 在用户输入 '[[' 时会自动闭合 ']]'，所以连续
 * 输入 '[[X]]' 后文档里实际有冗余 ']]'。如 '[[X]]]]'（共 7 字符）。
 * 用户再按 '^' 触发，文档为 '[[X]]]]^'，cursor=8。
 *
 * 因此我们：
 *   1) 确认光标前最后一个字符是 '^'
 *   2) 确认 '^' 之前紧贴着 ']]'（beforeCaret 必须以 ']]' 结尾）
 *   3) 在 ']]' 之前找最近的 '[[' 作为 wiki link 起点
 *   4) 中间作为 page name（不应含 '[' ']' '|'）
 *   5) 返回 doc 位置（不是 textBetween 偏移后的文本位置）：
 *      range = [[ doc 起点, cursor]，wikiEnd = doc 中 ']]' 之后的位置
 *
 * 注意：ProseMirror 中 'doc.position' 比 text node 的字符位置多 1
 * （text node 前有 paragraph open token），所以从 textBetween 算出的
 * 索引要 +1 转回 doc 位置。
 */
export function findRelationshipAtCaret(
  doc: any,
  pos: number
): RelationshipAtCaretResult {
  // 用 doc.textBetween 取 cursor 前的纯文本（不包含 block 边界）
  const text = doc.textBetween(0, pos, '\n', '\n')
  if (!text.endsWith('^')) {
    return { found: false, range: null, wikiEnd: null, pageName: '' }
  }

  const beforeCaret = text.slice(0, -1) // 去掉末尾的 '^'
  // 约束：^ 必须紧贴 ]]，否则不触发
  if (!beforeCaret.endsWith(']]')) {
    return { found: false, range: null, wikiEnd: null, pageName: '' }
  }

  // ]] 在 beforeCaret 中的起始位置
  const lastCloseIdx = beforeCaret.length - 2
  const wikiEndInText = lastCloseIdx + 2
  const beforeWiki = beforeCaret.slice(0, lastCloseIdx)
  const lastOpenIdx = beforeWiki.lastIndexOf('[[')
  if (lastOpenIdx < 0) {
    return { found: false, range: null, wikiEnd: null, pageName: '' }
  }

  const pageName = beforeWiki.slice(lastOpenIdx + 2)
  if (pageName.length === 0 || pageName.includes('[') || pageName.includes(']') || pageName.includes('|')) {
    return { found: false, range: null, wikiEnd: null, pageName: '' }
  }

  // textStart 是 doc 中第一段 text 节点的起始位置（doc position）
  // 例如 doc = <p>[[X]]^]]，paragraph open 在 pos 0，text 起点在 pos 1
  // textBetween(0, 7) 返回 6 chars '[[X]]^'，textStart = 7 - 6 = 1
  // 这正好是 text node 在 doc 中的起点
  const textStart = pos - text.length
  const wikiStartInText = lastOpenIdx
  const wikiEndInTextAfter = wikiEndInText

  const fromDocPos = textStart + wikiStartInText
  const wikiEndDocPos = textStart + wikiEndInTextAfter

  return {
    found: true,
    range: { from: fromDocPos, to: pos },
    wikiEnd: wikiEndDocPos,
    pageName
  }
}

function closeRelationshipMenuByExtension(view: any, reason: 'cursor-move' | 'doc-change' | 'escape' = 'doc-change') {
  if (!menuIsOpen) return
  menuIsOpen = false
  const closeEvent = new CustomEvent<RelationshipCloseEvent>('relationship-close', {
    bubbles: true,
    detail: { reason }
  })
  view.dom.dispatchEvent(closeEvent)
}

function triggerRelationshipMenu(
  view: any,
  position: number,
  range: { from: number; to: number },
  wikiEnd: number,
  pageName: string
) {
  menuIsOpen = true
  const event = new CustomEvent<RelationshipTriggerEvent>('relationship-trigger', {
    bubbles: true,
    detail: { view, position, range, wikiEnd, pageName }
  })
  view.dom.dispatchEvent(event)
}

function handleRelationshipDetection(view: any) {
  const { state } = view
  const cursorPos = state.selection.from
  const result = findRelationshipAtCaret(state.doc, cursorPos)
  if (result.found && result.range && result.wikiEnd !== null) {
    if (!menuIsOpen) {
      triggerRelationshipMenu(view, cursorPos, result.range, result.wikiEnd, result.pageName)
    }
  }
}

export const RelationshipTriggerExtension = Extension.create({
  name: 'relationshipTrigger',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('relationshipTrigger'),
        props: {
          handleTextInput(view, _from, _to, text) {
            if (selectingFromMenu) return false
            if (text === '^') {
              // 用 setTimeout 确保 '^' 已被插入到 doc，再检测
              setTimeout(() => {
                handleRelationshipDetection(view)
              }, 0)
            }
            return false
          },
          handleKeyDown: (view, event) => {
            if (!menuIsOpen) return false
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              closeRelationshipMenuByExtension(view, 'escape')
              return true
            }
            if (event.key === 'Enter') {
              // 选中和关闭由 menu 自己处理（onSelect 走 select()）
              event.preventDefault()
              event.stopPropagation()
              return true
            }
            if (event.key === 'Backspace' || event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              setTimeout(() => {
                const r = findRelationshipAtCaret(view.state.doc, view.state.selection.from)
                if (!r.found && menuIsOpen) {
                  closeRelationshipMenuByExtension(view, 'doc-change')
                } else if (r.found) {
                  handleRelationshipDetection(view)
                }
              }, 0)
            }
            return false
          }
        },
        view(_view: any) {
          return {
            update(view: any, prevState: any) {
              if (view.state.doc === prevState.doc) return
              if (!menuIsOpen) return
              // 文档结构变化时重新检测
              const r = findRelationshipAtCaret(view.state.doc, view.state.selection.from)
              if (!r.found && menuIsOpen) {
                closeRelationshipMenuByExtension(view, 'doc-change')
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
