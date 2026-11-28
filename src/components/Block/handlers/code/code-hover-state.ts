/**
 * 指针是否停在该代码块上（模块级，只记最近一个块）。
 *
 * 为什么要记在组件外面：代码块会随 `isActive` 在「渲染态 / 编辑态」两个 v-if 分支间
 * **整体重挂载**（DOM 被替换）。而 `:hover` 是浏览器按指针位置算出来的，节点被换掉后
 * 要等下一次鼠标事件才重算 —— 中间那一拍 `.code-toolbar`（hover 才显示）会掉下去，
 * 鼠标一动又浮上来，看起来就是「激活时工具栏闪一下」。
 *
 * 把「指针在不在」记在这里，新实例挂载时直接读回，跨重挂载不丢。
 */
let hoveredBlockId: string | null = null

export const codeHoverState = {
  get(blockId: string): boolean {
    return hoveredBlockId === blockId
  },

  enter(blockId: string): void {
    hoveredBlockId = blockId
  },

  /**
   * @param stillConnected 触发 leave 的元素是否还挂在文档里。
   *   节点被卸载时 Chromium 也会派一次 pointerleave —— 那不是「指针移开」，
   *   否则重挂载后的新实例会把悬停态丢掉，正是要修的那个闪。
   */
  leave(blockId: string, stillConnected: boolean): void {
    if (!stillConnected) return
    if (hoveredBlockId === blockId) hoveredBlockId = null
  },
}
