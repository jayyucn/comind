// Ideas 快照只读渲染的共享注入上下文（IdeasSnapshotPage → IdeasSnapshotNode）
import type { Property } from '../../types/property'

/** 折叠状态控制器（页面级共享） */
export interface SnapshotTreeState {
  isCollapsed(blockId: string): boolean
  toggle(blockId: string): void
}

export const SNAPSHOT_PROPS_KEY = Symbol('ideasSnapshotProps')
export const SNAPSHOT_TREE_KEY = Symbol('ideasSnapshotTree')
/** 快照只读 BlockModal 标记（ADR-0042 T6）：非空即处于弹窗内，dot 不再递归开弹窗 */
export const SNAPSHOT_MODAL_KEY = Symbol('ideasSnapshotModal')

export interface SnapshotPropsMap {
  /** blockId → 该块当日属性（快照 properties map） */
  propsByBlock: Record<string, Property[]>
  getBlockProps(blockId: string): Property[]
}
