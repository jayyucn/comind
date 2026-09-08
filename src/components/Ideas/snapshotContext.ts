// Ideas 快照只读渲染的共享注入上下文（IdeasSnapshotPage → IdeasSnapshotNode）
import type { Property } from '../../types/property'

/** 折叠状态控制器（页面级共享） */
export interface SnapshotTreeState {
  isCollapsed(blockId: string): boolean
  toggle(blockId: string): void
}

export const SNAPSHOT_PROPS_KEY = Symbol('ideasSnapshotProps')
export const SNAPSHOT_TREE_KEY = Symbol('ideasSnapshotTree')

export interface SnapshotPropsMap {
  /** blockId → 该块当日属性（快照 properties map） */
  propsByBlock: Record<string, Property[]>
  getBlockProps(blockId: string): Property[]
}
