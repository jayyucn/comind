import type { TreeNode, Block } from '../types/block'

/**
 * 从扁平 Block 数组构建树形结构
 *
 * 按 pos 升序排列后，按 parentId 组装为 TreeNode[] 递归树。
 * 树中的 children 顺序与 pos 排序一致。
 *
 * @param blocks - 当前页面的所有 Block（扁平数组）
 * @param pageId - 页面 ID（过滤用）
 * @param rootBlockId - 页面根 Block ID（不渲染为可见节点，其子节点作为可见一级节点）
 * @returns 可见根节点列表（parentId === rootBlockId 的节点）
 */
export function buildTree(blocks: Block[], pageId: string, rootBlockId: string | null): TreeNode[] {
  const pageBlocks = blocks
    .filter(b => b.pageId === pageId && b.id !== rootBlockId) // 排除根 Block
    .sort((a, b) => a.pos - b.pos)

  const map = new Map<string, TreeNode>()
  const roots: TreeNode[] = []

  // 第一遍：创建所有节点
  for (const block of pageBlocks) {
    map.set(block.id, { id: block.id, block, children: [] })
  }

  // 第二遍：按 parentId 组装树
  for (const block of pageBlocks) {
    const node = map.get(block.id)!
    if (block.parentId && map.has(block.parentId)) {
      map.get(block.parentId)!.children.push(node)
    } else if (block.parentId === rootBlockId || !block.parentId) {
      // parentId 指向根 Block 或为 null → 作为可见一级节点
      roots.push(node)
    }
    // block.parentId 存在但找不到父节点且不是根 Block → 孤儿节点，不挂载
  }

  return roots
}

/**
 * 将树形结构同步回 store
 *
 * 递归遍历树，对每个节点：
 * 1. 设置 parentId（可能因跨容器拖拽而改变）
 * 2. 按 children 顺序分配连续 pos 值
 * 3. 标记为 dirty 触发持久化
 *
 * @param nodes - 树节点列表
 * @param parentId - 当前层级的父节点 ID（null = 根级）
 * @param gapSize - pos 步长（默认 1000）
 * @returns 所有被修改的 block id 列表
 */
export function syncTreeToStore(
  nodes: TreeNode[],
  parentId: string | null,
  allBlocks: Block[],
  gapSize: number = 1000
): string[] {
  const changed: string[] = []

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    const expectedPos = (i + 1) * gapSize
    const block = allBlocks.find(b => b.id === node.id)

    if (block) {
      let dirty = false

      if (block.parentId !== parentId) {
        block.parentId = parentId
        dirty = true
      }
      if (block.pos !== expectedPos) {
        block.pos = expectedPos
        dirty = true
      }
      if (dirty) {
        block.updatedAt = Date.now()
        changed.push(block.id)
      }
    }

    // 递归处理子节点
    const childChanged = syncTreeToStore(node.children, node.id, allBlocks, gapSize)
    changed.push(...childChanged)
  }

  return changed
}
