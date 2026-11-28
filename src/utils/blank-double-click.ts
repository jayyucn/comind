/**
 * 双击页面留白不选词。
 *
 * 浏览器双击落点若不在文本上，会把选区扩展到「最近的词」——正文两侧留白、标题行右侧、
 * 反链面板行间都会因此选中相邻文本（实测：双击块列表两侧空白选中页面标题 /
 * 「反向链接」的「反向」）。
 *
 * 选词在**第二次 mousedown** 时起算，所以只有 mousedown 的 preventDefault 能真正拦住；
 * dblclick / selectionchange 之后再清选区会先闪一帧高亮。
 *
 * 「空白」判定 = 命中元素自身没有任何非空直接文本节点（浏览器就近选词的入口条件相同）。
 * 块内与可编辑区一律不拦：空段落没有文本节点，拦掉会连「双击空块放光标」一起废掉。
 */

/** 块内 / 可编辑区：这些地方的双击语义（放光标、选词、进编辑）不受本规则影响 */
const BLANK_EXEMPT_SCOPE = '[data-block-id], .ProseMirror, .tiptap, [contenteditable="true"], input, textarea, select, .cm-editor'

function hasDirectText(el: HTMLElement): boolean {
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent && node.textContent.trim()) return true
  }
  return false
}

/**
 * 是否「双击落在页面内容区的空白上」。
 *
 * 作用域限定 `.pane-body`（页面内容区）：侧栏、顶栏、Teleport 出去的弹层不参与——
 * 那里的空白双击不涉及正文选区。
 */
export function isBlankSurfaceDoubleClick(e: MouseEvent): boolean {
  if (e.detail < 2) return false
  const el = e.target as HTMLElement | null
  if (!el || typeof el.closest !== 'function') return false
  if (!el.closest('.pane-body')) return false
  if (el.closest(BLANK_EXEMPT_SCOPE)) return false
  return !hasDirectText(el)
}
