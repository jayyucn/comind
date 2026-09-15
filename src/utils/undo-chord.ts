import { useBlockStore } from '../stores/blocks'
import { hasStack } from '../composables/useUndoHistory'

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

/** 接管成功时返回的信息：恢复编排放调用方做（带/不带落点是两者的本质差异） */
export interface UndoTakeover {
  pageId: string
  chord: Exclude<UndoChord, null>
}

/**
 * 撤销/重做接管的四步相同链（#114）：chord 裁决 → scope 解析 → hasStack 门 →
 * preventDefault + stopPropagation。BlockList 的捕获接管与 App 的全局兜底此前
 * 各手写一遍这四步（逐行同构），收口到本函数后各剩一行调用；**scope 解析与
 * dispatch 有意留在调用方**：
 * - scope 解析：BlockList 有实例归属兜底（依赖组件 root/props），App 只认块内焦点；
 * - dispatch：BlockList 带落点闪烁（#109），App 不带（弹窗经响应式自刷）。
 *
 * ⚠️ 让位契约（时序不变量，唯一文档点）：两个 document 捕获监听器靠**注册顺序**
 * 分先后 —— BlockList 挂载时先注册，App 兜底在 App.vue onMounted 后注册、执行
 * 晚于 BlockList，故 App 侧调用前须检查 `e.defaultPrevented`（= BlockList 已
 * 接管的信号）自行让位。本函数**有意不读** defaultPrevented：接管方（BlockList）
 * 若也读，会被其它更早的 preventDefault 误伤；让位语义归兜底方所有。
 * 新增按键入口时：先注册者优先，后来者必须让位。
 *
 * 返回 null = 本调用方不接管（**未**调用 preventDefault/stopPropagation，按键
 * 交还原生行为或后续监听者）；返回 UndoTakeover = 已接管（两个方法均已调用）。
 */
export function takeOverUndoRedo(
  e: KeyboardEvent,
  resolvePage: (e: KeyboardEvent) => string | null,
): UndoTakeover | null {
  const chord = resolveUndoChord(e)
  if (!chord) return null
  const pageId = resolvePage(e)
  if (!pageId || !hasStack(pageId)) return null
  e.preventDefault()
  e.stopPropagation()
  return { pageId, chord }
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
