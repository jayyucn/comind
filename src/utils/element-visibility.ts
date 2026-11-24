/**
 * 元素是否处于「隐藏容器」中（自身或任一祖先 `display:none` / `visibility:hidden`）。
 *
 * 用途：同一 pane 内的多个 tab 视图会把非活动 tab 留在 DOM 里（`display:none`）而不卸载，
 * 其中的 Block / 编辑器组件照常挂载、照常响应全局 `activeBlockId`。这类「看不见的实例」
 * 有两个真实后果：
 * - 它的编辑器 DOM 没有几何（`getBoundingClientRect()` 全 0），拿它算光标坐标会得到 (0,0)；
 * - 它会抢先执行 `setActiveEditor`，让全局活动编辑器指向一份用户看不见的实例。
 *
 * 判据刻意不用「尺寸是否为 0」：jsdom 不布局，任何元素都报 0，那样会把测试与未完成布局的
 * 正常挂载一并误杀。只有明确被隐藏的容器才算，正常元素一律放行。
 */
export function hasHiddenAncestor(el: Element | null | undefined): boolean {
  if (!el) return false
  const view = el.ownerDocument?.defaultView
  if (!view) return false
  let node: Element | null = el
  while (node && node !== el.ownerDocument.body) {
    const style = view.getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden') return true
    node = node.parentElement
  }
  return false
}
