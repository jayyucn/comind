import { useBlockStore } from '../stores/blocks'

/**
 * 撤销/重做键位裁决（ADR-0046 T4 / #109）。
 *
 * 统一栈全权接管（D2），所以「哪个 chord 算撤销」必须是**单一裁决点**：
 * 文档捕获处理器、以及将来任何新的按键入口都只认这一个函数，避免各写一套
 * 条件后出现「某个焦点下 Ctrl+Shift+Z 落到原生行为」的漂移。
 *
 * 口径：
 * - Ctrl/Cmd+Z → undo；Ctrl/Cmd+Shift+Z → redo（macOS 惯例同源）
 * - Ctrl/Cmd+Y（含带 Shift）→ redo（Windows 惯例）
 * - 带 Alt 的组合一律不接管 —— Ctrl+Alt+Z 是输入法/系统级语义，不是编辑器撤销
 * - 无 Ctrl/Cmd 时一律不接管，保证正常输入（直接敲 z / y）不受影响
 */
export type UndoChord = 'undo' | 'redo' | null

/** 裁决所需的最小事件形状（KeyboardEvent 天然满足；单测无需构造 DOM 事件） */
export interface UndoChordEvent {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

export function resolveUndoChord(e: UndoChordEvent): UndoChord {
  if (!e.ctrlKey && !e.metaKey) return null
  if (e.altKey) return null
  switch (e.key.toLowerCase()) {
    case 'z':
      return e.shiftKey ? 'redo' : 'undo'
    case 'y':
      return 'redo'
    default:
      return null
  }
}

/**
 * 撤销作用域的「块内焦点」裁决（ADR-0046 T4 / #109）。
 *
 * 与 `resolveUndoChord`（哪个组合键算撤销）配套的**唯一作用域裁决点**：
 * BlockList 的接管与 App 的全局兜底都复用它，避免两处各写一套 sidebar /
 * input / 块的判定后出现漂移（B2 重复代码）。只认「块内焦点」，返回该块所属页
 * id；其余一律 null：
 * - 侧栏内（.sidebar-wrapper）→ null
 * - 原生输入控件（input / textarea）→ null（浏览器自身撤销保留）
 * - 非块元素（空白 / 属性区 / 弹窗外）→ null（实例归属兜底交由调用方决定）
 */
export function resolveUndoScopeBlockPage(e: KeyboardEvent): string | null {
  const target = e.target as HTMLElement | null
  if (!target || typeof target.closest !== 'function') return null
  if (target.closest('.sidebar-wrapper')) return null
  if (target.closest('input, textarea')) return null
  const blockEl = target.closest('[data-block-id]') as HTMLElement | null
  if (!blockEl) return null
  const blockStore = useBlockStore()
  return blockStore.getBlock(blockEl.dataset.blockId ?? '')?.pageId ?? null
}
