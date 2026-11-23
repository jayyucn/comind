import type { Node as PMNode } from '@tiptap/pm/model'

/** 硬换行（Shift-Enter）在正文里的字面形态：与 `inlineMarksToHtml` 的 `<br>` 一一对应。 */
export const HARD_BREAK_TEXT = '\n'

/**
 * 编辑器文档 → 落库正文。
 *
 * TipTap 的 `editor.getText()` / `textBetween()` 只累加文本节点，**跳过 hardBreak**
 * （`getTextBetween` 仅处理 `node.isText`，HardBreak 扩展也没注册 `toText` 序列化），
 * 于是 Shift-Enter 打出的段内换行在保存时被静默吞掉。
 *
 * 本函数是编辑器侧的**唯一**取文本口径：文本节点取原文，hardBreak 记作 `\n`。
 * 落库后由 `inlineMarksToHtml`（`\n` → `<br>`）读回，渲染态则由 `.block-text` 的
 * `white-space: pre-wrap` 直接吃字面换行 —— 两头闭环。
 */
export function docToText(doc: PMNode): string {
  let text = ''
  doc.descendants((node) => {
    if (node.isText) {
      text += node.text ?? ''
      return false
    }
    if (node.type.name === 'hardBreak') {
      text += HARD_BREAK_TEXT
    }
    return true
  })
  return text
}
