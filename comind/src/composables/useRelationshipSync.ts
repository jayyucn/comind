import { ref, watch, type Ref } from 'vue'
import { parseBlockLinks, type LinkParse } from '../utils/parser'

/**
 * 关系类型同步 composable
 *
 * 职责：
 * 1. 跟踪当前正在编辑的 Block（编辑中的内容不应被自动覆盖）
 * 2. 扫描当前页面的所有 Block，提取带关系类型的链接
 * 3. 提供 API：同步 / 移除同一页面内指向相同目标的关系类型
 *
 * 使用场景：
 * - 同一页面内多个 Block 都引用了 [[PageB]]
 * - 用户在某个 Block 中为 [[PageB]] 添加了 ^(depends-on) 关系类型
 * - 调用 syncRelationshipType() 后，页面内其他指向 PageB 的链接也会带上相同类型
 * - 用户删除某个关系类型时，调用 removeRelationshipType() 清理其他链接
 *
 * 关键约束：
 * - 跳过当前正在编辑的 Block（其内容由用户控制）
 * - 修改 Block 内容后必须重新调用 parseLinksFromBlocks() 刷新快照
 */
export interface RelationshipLinkSnapshot {
  blockId: string
  targetTitle: string
  relationshipType: string | null
}

export function useRelationshipSync(
  pageId: Ref<string | null>,
  blocks: Ref<Array<{ id: string; content: string }>>
) {
  // 当前正在编辑的 Block ID（其内容不应被同步逻辑覆盖）
  const editingBlockId = ref<string | null>(null)

  // blockId -> targetTitle -> 关系类型快照
  const linkSnapshot = ref<Map<string, Map<string, string | null>>>(new Map())

  /**
   * 解析当前所有 Block 中的关系类型链接，建立快照。
   * 注意：跳过正在编辑的 Block。
   */
  function refreshSnapshot() {
    const newSnapshot = new Map<string, Map<string, string | null>>()
    const pageBlocks = blocks.value

    for (const block of pageBlocks) {
      // 跳过正在编辑的 Block
      if (editingBlockId.value === block.id) continue

      const links: LinkParse[] = parseBlockLinks(block.content)
      const blockLinks = new Map<string, string | null>()

      for (const link of links) {
        if (link.isExternal) continue
        // 仅记录有显式关系类型（或曾经有过）的链接
        if (link.relationshipType !== null) {
          blockLinks.set(link.targetTitle, link.relationshipType)
        }
      }

      if (blockLinks.size > 0) {
        newSnapshot.set(block.id, blockLinks)
      }
    }

    linkSnapshot.value = newSnapshot
  }

  /**
   * 设置当前正在编辑的 Block
   *
   * @param blockId - Block ID，传 null 表示编辑结束
   */
  function setEditingBlock(blockId: string | null) {
    editingBlockId.value = blockId
    if (blockId === null) {
      // 编辑结束后刷新一次快照
      refreshSnapshot()
    }
  }

  /**
   * 同步关系类型：把当前 Block 中对 targetTitle 的关系类型，
   * 同步到页面内其他（非编辑中的）Block 中对同一 targetTitle 的链接上。
   *
   * 返回被修改的 Block 列表（不含正在编辑的 Block），调用方需自行持久化。
   *
   * @param sourceBlockId - 触发同步的 Block ID（通常就是正在编辑的 Block）
   * @param targetTitle - 目标页面标题
   * @param newRelationshipType - 新的关系类型，null 表示移除
   * @returns 需要更新内容的 Block 列表
   */
  function syncRelationshipType(
    sourceBlockId: string,
    targetTitle: string,
    newRelationshipType: string | null
  ): Array<{ id: string; content: string }> {
    const updated: Array<{ id: string; content: string }> = []

    for (const block of blocks.value) {
      if (block.id === sourceBlockId) continue
      if (block.id === editingBlockId.value) continue

      const previous = linkSnapshot.value.get(block.id)?.get(targetTitle)
      // 已有类型且与新类型相同：无需变更
      if (previous === newRelationshipType) continue

      // 检查该 Block 是否包含指向 targetTitle 的链接
      const links = parseBlockLinks(block.content)
      const hasLinkToTarget = links.some(l => !l.isExternal && l.targetTitle === targetTitle)
      if (!hasLinkToTarget) continue

      const newContent = applyRelationshipTypeToBlockContent(
        block.content,
        targetTitle,
        newRelationshipType
      )
      if (newContent === block.content) continue

      // 同步更新内存中的 Block
      block.content = newContent
      updated.push(block)
    }

    // 同步更新快照
    if (newRelationshipType === null) {
      for (const [snapBlockId, targetMap] of linkSnapshot.value.entries()) {
        if (updated.some(u => u.id === snapBlockId)) {
          targetMap.delete(targetTitle)
        }
      }
    } else {
      for (const [snapBlockId, targetMap] of linkSnapshot.value.entries()) {
        if (updated.some(u => u.id === snapBlockId)) {
          targetMap.set(targetTitle, newRelationshipType)
        }
      }
    }

    return updated
  }

  /**
   * 移除页面内所有（非编辑中的）Block 中对 targetTitle 的关系类型
   * 仅移除 ^(...) 部分，保留 [[link]] 本身。
   */
  function removeRelationshipType(
    targetTitle: string
  ): Array<{ id: string; content: string }> {
    return syncRelationshipType('__remove__', targetTitle, null)
  }

  // 监听 pageId 或 blocks 变化，自动刷新快照
  // 使用 sync flush 确保在测试和组件挂载时立即可见
  watch(
    [pageId, () => blocks.value.map(b => `${b.id}:${b.content}`).join('|')],
    () => {
      refreshSnapshot()
    },
    { immediate: true, flush: 'sync' }
  )

  return {
    editingBlockId,
    linkSnapshot,
    refreshSnapshot,
    setEditingBlock,
    syncRelationshipType,
    removeRelationshipType
  }
}

/**
 * 在 Block 内容中，对所有指向 targetTitle 的链接应用新的关系类型。
 * - 若 newRelationshipType 为 null：移除 ^(...) 部分
 * - 若 newRelationshipType 不为 null：若链接已有关系类型则替换，否则追加
 *
 * 处理两种形式：
 * bghntvy567link]]^(existingType) → 替换或移除 existingType
 * - [[link]] → 追加 ^(newType)
 */
export function applyRelationshipTypeToBlockContent(
  content: string,
  targetTitle: string,
  newRelationshipType: string | null
): string {
  const escapedTitle = targetTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // 匹配 [[target]] 或 [[target|alias]]，可选带 ^(relationType)
  // 使用两个独立的正则：带关系类型、不带关系类型
  const withTypeRegex = new RegExp(
    `\\[\\[(${escapedTitle})(?:\\|[^\\]]+?)?\\]\\]\\^?\\(([^)]+)\\)`,
    'g'
  )
  const plainLinkRegex = new RegExp(
    `\\[\\[(${escapedTitle})(?:\\|[^\\]]+?)?\\]\\](?!\\^\\()`,
    'g'
  )

  // 第一步：替换已带关系类型的链接
  let result = content.replace(withTypeRegex, (match) => {
    const baseMatch = match.match(/^\[\[[^\]]+?\]\]/)
    if (!baseMatch) return match
    if (newRelationshipType === null) return baseMatch[0]
    return `${baseMatch[0]}^(${newRelationshipType})`
  })

  // 第二步：仅当需要添加新类型时，处理不带关系类型的链接
  if (newRelationshipType !== null) {
    // 使用更严格的负向先行：避免重复处理已被 withTypeRegex 替换的链接
    // 由于 withTypeRegex 已处理所有带类型的链接，剩下都是纯 [[link]] 形式
    result = result.replace(plainLinkRegex, (match) => {
      return `${match}^(${newRelationshipType})`
    })
  }

  return result
}
