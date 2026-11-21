import type { VNode } from 'vue'
import { shallowReactive } from 'vue'

import type { Block } from '../types/block'

/**
 * 块入口菜单的**类型专属段**（菜单收敛到 Block 外壳之后，handler 交出来的那部分）。
 *
 * 菜单从「每个 handler 各自持有 popover」收敛成「Block 外壳一层」以后，类型专属项
 * （表格的首行表头、查询块的粘贴收尾）仍得由 handler 提供 —— 它们依赖 handler 的
 * **实例内状态**（`header` 这类 ref），外壳拿不到；而把 TableBlock 的状态搬进 store
 * 是另一件事，代价远大于本次。
 *
 * 交接方式是这份最小注册表：handler 挂载时 `register(blockId, extra)`，卸载时
 * `unregister(blockId, extra)`；外壳按 blockId 取用，把 `render()` 的结果渲染在通用段之上。
 * `render()` 在**外壳的渲染 effect 里**调用，所以它内部读到的 ref 依赖照常被追踪 ——
 * 开关的勾选态跟着 `header` 变，不需要额外通知。
 *
 * 同一 blockId 可能同时挂两个实例（双 pane 同页）：后注册者胜出，`unregister` 带实例身份，
 * 先卸载的那一份不会误删另一份。菜单点开时用的是最近挂载的那份状态。
 */
export interface BlockEntryMenuExtra {
  /**
   * 类型专属菜单项（`BlockMenuItem` 等），排在通用段**之上**；空数组等于没有专属项。
   *
   * `close` 由外壳给：专属项点下去后要关掉菜单，而菜单的开合状态只在外壳手里。
   */
  render: (close: () => void) => VNode[]
  /** 类型专属的粘贴收尾（query 块克隆命名视图用） */
  afterPaste?: (created: Block[], sourceIds: string[]) => void | Promise<void>
}

/**
 * 用 Map 而不是普通对象：`get(blockId)` 只订阅这一个键，
 * 一个表格块挂载不会把所有 Block 的渲染 effect 全部失效。
 */
const extras = shallowReactive(new Map<string, BlockEntryMenuExtra>())

export function useBlockEntryMenuExtra() {
  function register(blockId: string, extra: BlockEntryMenuExtra): void {
    if (!blockId) return
    extras.set(blockId, extra)
  }

  /** 带实例身份：当前登记的不是自己时不动（双 pane 同页的另一份还在用） */
  function unregister(blockId: string, extra?: BlockEntryMenuExtra): void {
    if (!blockId) return
    if (extra && extras.get(blockId) !== extra) return
    extras.delete(blockId)
  }

  /** 该块的类型专属段；无专属项返回 null（通用段据此决定要不要自带前置分隔线） */
  function get(blockId: string): BlockEntryMenuExtra | null {
    return extras.get(blockId) ?? null
  }

  return { register, unregister, get }
}
