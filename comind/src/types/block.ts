export interface Block {
  id: string
  pageId: string
  parentId: string | null
  pos: number  // 排序位置（Gap 排序，初始间隔 1000）
  content: string
  format: Record<string, any>
  type: 'bullet' | 'property' | 'query' | 'embed' | 'code' | 'image'
  /** Pre-computed render segments from Rust (S10). Array of structured instructions
   *  for rendering content. Empty for code/image/embed/query types. */
  renderSegments?: import('../wasm/types').RenderSegment[]
  /** Block properties resolved from Property table by Rust (4.2). Stored as raw Rust Property[]. */
  properties?: import('../wasm/types').Property[]
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

export interface SubtreeNode {
  block: Block
  children: SubtreeNode[]
}

/**
 * 复制 block 时随行的剪贴板载荷节点（ADR-0025 D4）。
 *
 * - 携带：content / type / format / properties / children（子树，递归）
 * - 重生成（不携带语义）：id / parentId / pos / pageId / 时间戳 —— 粘贴时一律新建
 * - id 仅为「子树内部自引用重映射」而随行（ADR-0025 D6），
 *   粘贴时基于「旧 id → 新 id」映射重写 content 内部引用，绝不复用旧 id
 */
export interface BlockClipPayload {
  /** 源 block id，仅用于粘贴时重映射子树内部自引用 */
  id?: string
  content: string
  type: Block['type']
  format: Record<string, unknown> | null
  properties: Record<string, { value: string; type: string }> | null
  children: BlockClipPayload[]
}

/** 剪贴板顶层载荷（ADR-0025 D5），序列化为自定义 MIME `application/x-comind-block` 的 JSON */
export interface BlockClipboardPayload {
  version: 1
  kind: 'blocks'
  blocks: BlockClipPayload[]
}
