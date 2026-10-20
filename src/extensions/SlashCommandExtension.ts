import { Extension } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

/**
 * 检查光标是否在 URL 中
 */
function isInURL(doc: Node, pos: number): boolean {
  const $pos = doc.resolve(pos)
  const textBefore = $pos.nodeBefore?.text || ''

  //检测是否在 [[[...]] 中
  if (textBefore.match(/\[\[([^[\]]*)/)){
    const textAfter = $pos.nodeAfter?.text || ''
    if (textAfter.match(/[^[\]]*\]\]/)) return true
  }

  // 检查前面是否有 ://（URL 协议）
  if (textBefore.match(/https?:\/\/[^\s]*$/)) return true
  if (textBefore.match(/ftp:\/\/[^\s]*$/)) return true

  // 检查是否在邮箱中
  if (textBefore.match(/[\w.-]+@[\w.-]+$/)) return true

  return false
}

export interface SlashCommandTriggerEvent {
  view: EditorView
  position: number
  range: { from: number; to: number }
}

/**
 * 斜杠命令扩展
 * 监听 `/` 输入，触发自定义事件给 Vue 层处理
 */
export const SlashCommandExtension = Extension.create({
  name: 'slashCommand',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('slashCommand'),
        props: {
          handleTextInput: (view, from, to, text) => {
            // 只处理 `/` 输入
            if (text !== '/') return false

            const { state } = view

            // 检查是否在 URL 中（不触发）
            if (isInURL(state.doc, from)) {
              return false
            }

            // 触发自定义事件
            const event = new CustomEvent<SlashCommandTriggerEvent>('slash-command-trigger', {
              bubbles: true,
              detail: {
                view,
                position: from,
                range: { from, to: to + 1 }
              }
            })
            view.dom.dispatchEvent(event)

            return false // 不阻止默认行为，让 `/` 正常输入
          }
        },
        // 光标落在已有 `/` 右侧时也弹出面板（点击定位 / 方向键 / 退格回到斜杠后均触发）。
        // 键入 `/` 本身会先经 handleTextInput 触发一次，此处会再触发一次，
        // 由菜单侧「同编辑器同锚点」去重，不会重置 query。
        view() {
          return {
            update(view, prevState) {
              const { state } = view
              const sel = state.selection
              // 仅处理光标移动；非空选区（拖选）不触发
              if (!sel.empty || sel.from === prevState.selection.from) return

              const slashPos = sel.from - 1
              if (slashPos < 0) return
              if (isInURL(state.doc, sel.from)) return

              const $pos = state.doc.resolve(sel.from)
              const textBefore = $pos.nodeBefore?.text || ''
              if (!textBefore.endsWith('/')) return

              const event = new CustomEvent<SlashCommandTriggerEvent>('slash-command-trigger', {
                bubbles: true,
                detail: {
                  view,
                  position: slashPos,
                  range: { from: slashPos, to: slashPos + 1 }
                }
              })
              view.dom.dispatchEvent(event)
            }
          }
        }
      })
    ]
  }
})
