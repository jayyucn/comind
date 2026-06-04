import { useBlockStore } from '../stores/blocks'
import { usePageStore } from '../stores/pages'
import { parseBlockLinks } from '../utils/parser'
import { applyRelationshipTypeToBlockContent } from './useRelationshipSync'

export interface OrphanedTarget {
  targetTitle: string
  inverseType: string
}

export interface CleanupResult {
  /** 被修改的跨页 block 列表（已持久化） */
  modifiedCrossPageBlocks: Array<{ id: string; pageId: string; content: string }>
  /** 被识别为需要跨页清理的目标集合（去重） */
  orphanedTargets: OrphanedTarget[]
}

/**
 * Block 删除后的语义关系整理 composable
 *
 * 职责：在一组 Block 被删除后，处理它们涉及到的反向 typed-link，
 * 避免出现"源端已删、目标端还挂着 typed 类型"的悬空引用。
 *
 * 流程：
 * 1. 解析被删 blocks 中带 inverse 的 typed-link 目标
 * 2. 调 blockStore.deleteBlock 删除（级联清理 link 表的出向 link + properties）
 * 3. 对每个目标：若本页 SURVIVING blocks 已无 typed-link 维持，跨页降级反向引用
 *
 * 边界：
 * - 仅处理带 inverseRelationshipType 的 link（单向 ^(depends-on) 不参与）
 * - 同页其他 block 仍含 typed-link 到目标 → 跳过
 * - 跨页降级保留 [[link]] 本身，只移除 ^(...) 部分
 */
export function useBlockRelationshipCleanup() {
  const blockStore = useBlockStore()
  const pageStore = usePageStore()

  /**
   * 在一组 Block 被删除后，整理它们涉及到的语义关系。
   *
   * @param pageId 被删 block 所属页的 pageId
   * @param deletedBlockIds 被删除的 block ID 集合
   */
  async function cleanupAfterDelete(
    pageId: string,
    deletedBlockIds: string[]
  ): Promise<CleanupResult> {
    const result: CleanupResult = {
      modifiedCrossPageBlocks: [],
      orphanedTargets: []
    }

    if (deletedBlockIds.length === 0) return result

    // 1. 收集被删 blocks 中带 inverse 的 typed-link 目标（去重）
    // targetTitle -> inverseType
    const targetSet = new Map<string, string>()
    for (const id of deletedBlockIds) {
      const block = blockStore.blocks.find(b => b.id === id)
      if (!block) continue
      const links = parseBlockLinks(block.content)
      for (const link of links) {
        if (link.isExternal) continue
        if (link.relationshipType === null) continue
        if (link.inverseRelationshipType === null) continue
        targetSet.set(link.targetTitle, link.inverseRelationshipType)
      }
    }

    // 2. 调 blockStore.deleteBlock 删除（级联）— 无论是否能解析 page title，都要先删
    for (const id of deletedBlockIds) {
      await blockStore.deleteBlock(id)
    }

    // 3. 跨页清理：解析当前 pageId 对应的 title，定位反向引用
    const ourPageTitle = pageStore.pages.find(p => p.id === pageId)?.title ?? null
    if (!ourPageTitle) return result

    // 4. 对每个目标：检查本页 SURVIVING blocks 是否仍有 typed-link 维持
    for (const [targetTitle, inverseType] of targetSet) {
      const stillHasTypedLink = blockStore.blocks.some(b => {
        if (b.pageId !== pageId) return false
        if (deletedBlockIds.includes(b.id)) return false
        const links = parseBlockLinks(b.content)
        return links.some(l =>
          !l.isExternal &&
          l.targetTitle === targetTitle &&
          l.relationshipType !== null
        )
      })

      if (stillHasTypedLink) continue

      // 跨页降级：扫描目标页面所有 blocks，移除 [[ourPageTitle]]^(...) 类型后缀
      result.orphanedTargets.push({ targetTitle, inverseType })

      const targetPageId = pageStore.pages.find(p => p.title === targetTitle)?.id
      if (!targetPageId) continue

      const targetBlocks = blockStore.blocks.filter(b => b.pageId === targetPageId)
      for (const tb of targetBlocks) {
        const newContent = applyRelationshipTypeToBlockContent(tb.content, ourPageTitle, null)
        if (newContent !== tb.content) {
          await blockStore.updateBlockContent(tb.id, newContent)
          result.modifiedCrossPageBlocks.push({ id: tb.id, pageId: tb.pageId, content: newContent })
        }
      }
    }

    return result
  }

  return { cleanupAfterDelete }
}
