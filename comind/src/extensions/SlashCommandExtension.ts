import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

/**
 * 检查光标是否在 URL 中
 */
function isInURL(doc: any, pos: number): boolean {
  const $pos = doc.resolve(pos)
  const textBefore = $pos.nodeBefore?.text || ''

  // 检查前面是否有 ://（URL 协议）
  if (textBefore.match(/https?:\/\/[^\s]*$/)) return true
  if (textBefore.match(/ftp:\/\/[^\s]*$/)) return true

  // 检查是否在邮箱中
  if (textBefore.match(/[\w.-]+@[\w.-]+$/)) return true

  return false
}

export interface SlashCommandTriggerEvent {
  view: any
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
            const $from = state.doc.resolve(from)

            // 检查是否在 URL 中（不触发）
            if (isInURL(state.doc, from)) {
              return false
            }

            // 检查触发条件：block开头 或 前一个字符是空格
            const textBefore = $from.nodeBefore?.text || ''
            if (textBefore.length > 0 && !textBefore.match(/[\s\n]$/)) {
              // 前面有文本但末尾不是空格或换行，在单词中间，不触发
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
          },
          handleKeyDown: (_view, event) => {
            if (event.key === 'Backspace') {
           
              return false
            }
            if(event.key === 'Enter'){
              return true
            }
          }
        }
      })
    ]
  }
})
