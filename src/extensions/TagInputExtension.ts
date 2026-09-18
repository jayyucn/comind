import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Node } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'

/**
 * 打标签输入扩展（#132 / ADR-0049 "打标签输入 UX"）。
 *
 * 镜像 `SlashCommandExtension`：监听 `#` 输入，命中时向 DOM 派发
 * `tag-input-trigger` 自定义事件，由 Vue 层（TagSelectMenu）决定选择/创建标签。
 * 与斜杠命令（`/`）、关系菜单（`[[`/RelationshipTrigger）语义正交——各自前缀触发，互不打扰（E5）。
 */

/** 标签名最大长度（查询用） */
export const TAG_QUERY_MAX = 50

/**
 * 纯函数：从 `#` 之后紧邻的文本抽取标签查询词。
 * @param textAfterHash `#` 之后的字符序列（仅取当前文本节点内）
 * @returns 合法查询词；无有效字符（如 `#` 后紧跟空白或已到边界）返回 null
 */
export function parseTagQuery(textAfterHash: string): string | null {
  const m = textAfterHash.match(/^([^\s#]{1,50})/)
  return m ? m[1] : null
}

/** 检查光标是否在 URL / `[[...]]` 中（沿用 SlashCommandExtension 的护栏） */
function isInURL(doc: Node, pos: number): boolean {
  const $pos = doc.resolve(pos)
  const textBefore = $pos.nodeBefore?.text || ''

  if (textBefore.match(/\[\[([^[\]]*)/)) {
    const textAfter = $pos.nodeAfter?.text || ''
    if (textAfter.match(/[^[\]]*\]\]/)) return true
  }
  if (textBefore.match(/https?:\/\/[^\s]*$/)) return true
  if (textBefore.match(/ftp:\/\/[^\s]*$/)) return true
  if (textBefore.match(/[\w.-]+@[\w.-]+$/)) return true

  return false
}

/**
 * 纯函数：判断 `#` 是否应触发标签输入（不含 URL 判定，URL 判定需要 doc）。
 * 规则：
 *  - `#` 前必须是行首或空白（排除 `a#b` 这类词中 `#`）；
 *  - `#` 后不得紧跟空白（排除 Markdown 标题 `# `）。
 */
export function isTagTriggerText(textBeforeHash: string, textAfterHash: string): boolean {
  if (textBeforeHash.length > 0 && !/\s$/.test(textBeforeHash)) return false
  if (textAfterHash.length > 0 && /^\s/.test(textAfterHash)) return false
  return true
}

export interface TagInputTriggerEvent {
  view: EditorView
  position: number
  range: { from: number; to: number }
}

export const TagInputExtension = Extension.create({
  name: 'tagInput',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('tagInput'),
        props: {
          handleTextInput: (view, from, to, text) => {
            if (text !== '#') return false

            const { state } = view
            const $pos = state.doc.resolve(from)
            const textBefore = $pos.nodeBefore?.text || ''
            const textAfter = $pos.nodeAfter?.text || ''

            if (isInURL(state.doc, from)) return false
            if (!isTagTriggerText(textBefore, textAfter)) return false

            const event = new CustomEvent<TagInputTriggerEvent>('tag-input-trigger', {
              bubbles: true,
              detail: {
                view,
                position: from,
                // `#` 本身占一个位置；range 覆盖 `#` 到其后（供删除）
                range: { from, to: to + 1 },
              },
            })
            view.dom.dispatchEvent(event)

            return false // 不阻止默认行为，`#` 正常输入
          },
        },
      }),
    ]
  },
})
