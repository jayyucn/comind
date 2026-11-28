/**
 * 标题聚焦请求（跨重挂载传递）
 *
 * 渲染态点代码块标题要「先激活块，再把焦点落到标题输入框」：激活会让 Block 换分支
 * （渲染态组件卸载、编辑态组件重建），同一个组件实例拿不到这次点击的后续。用模块级
 * Set 把意图带到新实例的 onMounted 里消费，与 code-collapse-state 同构 —— 这点状态
 * 不属于 store，也不值得为一次聚焦加全局字段。
 */
const pending = new Set<string>()

export const codeTitleFocus = {
  request(blockId: string): void {
    pending.add(blockId)
  },
  /** 消费并清除；只有请求过的块返回 true */
  consume(blockId: string): boolean {
    return pending.delete(blockId)
  },
}
