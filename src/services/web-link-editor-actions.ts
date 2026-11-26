/**
 * 悬浮条在编辑态的就地改写（ADR-0067）：直接改 ProseMirror 文档，
 * 让常规 save 流程回写 store，保住光标与撤销栈；读态仍走 store 动作。
 */
import type { Editor } from '@tiptap/vue-3'

import {
  replaceChipLiteral,
  scanWebLinkChipsInDoc,
} from '../extensions/WebLinkChipExtension'
import { useEditorStore } from '../stores/editor'

function editorOf(blockId: string): Editor | null {
  const store = useEditorStore()
  return store.activeBlockId === blockId ? store.activeEditor : null
}

/** 把活动编辑器里的 chip 字面换成 replacement；返回是否真的就地改了 */
export function replaceActiveChip(
  blockId: string,
  match: { url: string; title: string },
  replacement: string,
): boolean {
  const editor = editorOf(blockId)
  if (!editor) return false
  const chip = scanWebLinkChipsInDoc(editor.state.doc).find(
    c => c.url === match.url && c.title === match.title,
  )
  if (!chip) return false
  replaceChipLiteral(editor.view, chip, replacement)
  return true
}

/** 悬浮条改完编辑态正文后立刻同步进 store，不等 300ms 防抖 */
export async function flushActiveChipBlock(blockId: string): Promise<void> {
  if (!editorOf(blockId)) return
  await useEditorStore().flushActiveContent(blockId)
}
