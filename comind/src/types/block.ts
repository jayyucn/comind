export interface Block {
  id: string
  pageId: string
  parentId: string | null
  pos: number  // 排序位置（Gap 排序，初始间隔 1000）
  content: string
  format: Record<string, any>
  type: 'bullet' | 'property' | 'query' | 'embed' | 'code'
  properties: Record<string, any>
  createdAt: number
  updatedAt: number
}

export interface BlockRecord {
  id: string
  pageId: string
  parentId: string | null
  pos: number
  content: string
  format: string
  type: string
  properties: string
  createdAt: number
  updatedAt: number
}

/**
 * 树形节点 — Block 的树形视图
 *
 * 由 useBlockTree 从扁平 blocks[] 构建，
 * 作为 VueDraggable 的 v-model 数据源，
 * 驱动递归渲染和拖拽排序。
 */
export interface TreeNode {
  id: string
  block: Block
  children: TreeNode[]
}
