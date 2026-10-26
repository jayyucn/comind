/**
 * 每 pane 独立导航栈（ADR-0059 D4）：纯逻辑，无路由/组件依赖，可单测。
 *
 * 语义：
 * - record：中段跳转截断 forward 分支后再压栈（回到历史中段后走新导航即丢弃「未来」）；
 *   与栈顶当前项一致时不重复压栈。
 * - back/forward：移动 index，越界返回 null（不动作）。
 * - previous：只读窥视后退目标（不移动 index），供 pane 面包屑显示上级页。
 * - removePage：从所有栈中剔除该页（页面删除回收），索引按「删除当前项」/「删除更早项」
 *   分别钳制，保持指向语义不漂移。
 */
export interface PaneStack {
  stack: string[]
  index: number
}

export interface PaneHistory {
  record: (paneId: string, pageId: string) => void
  ensure: (paneId: string, pageId: string) => void
  back: (paneId: string) => string | null
  forward: (paneId: string) => string | null
  previous: (paneId: string) => string | null
  canGoBack: (paneId: string) => boolean
  canGoForward: (paneId: string) => boolean
  removePage: (pageId: string) => void
}

export function createPaneHistory(): PaneHistory {
  const stacks = new Map<string, PaneStack>()

  function ensure(paneId: string, pageId: string): void {
    if (!stacks.has(paneId)) {
      stacks.set(paneId, { stack: [pageId], index: 0 })
    }
  }

  function record(paneId: string, pageId: string): void {
    const st = stacks.get(paneId)
    if (!st) {
      stacks.set(paneId, { stack: [pageId], index: 0 })
      return
    }
    if (st.stack[st.index] === pageId) return
    const stack = st.stack.slice(0, st.index + 1)
    stack.push(pageId)
    stacks.set(paneId, { stack, index: stack.length - 1 })
  }

  function canGoBack(paneId: string): boolean {
    const st = stacks.get(paneId)
    return !!st && st.index > 0
  }

  function canGoForward(paneId: string): boolean {
    const st = stacks.get(paneId)
    return !!st && st.index < st.stack.length - 1
  }

  function back(paneId: string): string | null {
    const st = stacks.get(paneId)
    if (!st || st.index <= 0) return null
    st.index--
    return st.stack[st.index]
  }

  function forward(paneId: string): string | null {
    const st = stacks.get(paneId)
    if (!st || st.index >= st.stack.length - 1) return null
    st.index++
    return st.stack[st.index]
  }

  /** 后退目标页（不移动索引）：栈为空或已在起点时返回 null */
  function previous(paneId: string): string | null {
    const st = stacks.get(paneId)
    if (!st || st.index <= 0) return null
    return st.stack[st.index - 1]
  }

  function removePage(pageId: string): void {
    for (const [paneId, st] of Array.from(stacks.entries())) {
      const newStack = st.stack.filter(id => id !== pageId)
      if (newStack.length === 0) {
        stacks.delete(paneId)
        continue
      }
      const removedBefore = st.stack.slice(0, st.index + 1).filter(id => id === pageId).length
      const newIndex = st.stack[st.index] === pageId
        ? Math.min(st.index, newStack.length - 1)
        : Math.max(0, st.index - removedBefore)
      stacks.set(paneId, { stack: newStack, index: newIndex })
    }
  }

  return { record, ensure, back, forward, previous, canGoBack, canGoForward, removePage }
}
