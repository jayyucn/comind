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
 * 2. 检查本页 SURVIVING blocks 是否仍含 typed-link 维持（关键：在删除前完成！）
 * 3. 调 blockStore.deleteBlock 删除（级联清理 link 表的出向 link + properties）
 * 4. 对每个目标：若本页 SURVIVING blocks 已无 typed-link 维持，跨页降级反向引用
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
    deletedBlockIds: string[],
    blocksBeforeDelete?: Array<ReturnType<typeof useBlockStore>['blocks'][0]>
  ): Promise<CleanupResult> {
    const result: CleanupResult = {
      modifiedCrossPageBlocks: [],
      orphanedTargets: []
    }

    if (deletedBlockIds.length === 0) return result

    // 在删除前保存 blocks 的快照，因为删除后 blockStore.blocks 会改变！
    const blocks = blocksBeforeDelete ?? [...blockStore.blocks]

    // 1. 收集被删 blocks 中带 inverse 的 typed-link 目标（去重）
    // targetTitle -> inverseType
    const targetSet = new Map<string, string>()
    for (const id of deletedBlockIds) {
      const block = blocks.find(b => b.id === id)
      if (!block) continue
      const links = parseBlockLinks(block.content)
      for (const link of links) {
        if (link.isExternal) continue
        if (link.relationshipType === null) continue
        if (link.inverseRelationshipType === null) continue
        targetSet.set(link.targetTitle, link.inverseRelationshipType)
      }
    }

    // 2. 跨页清理准备：解析当前 pageId 对应的 title
    const ourPageTitle = pageStore.pages.find(p => p.id === pageId)?.title ?? null

    // 3. 检查本页 SURVIVING blocks 是否仍含 typed-link 维持（关键：在删除之前！）
    // 这是关键修复点！如果我们先删除再检查，检查逻辑会错误地判断所有 blocks 都是 surviving
    const survivingTypedLinks = new Set<string>()
    if (ourPageTitle) {
      for (const [targetTitle] of targetSet) {
        const stillHasTypedLink = blocks.some(b => {
          if (b.pageId !== pageId) return false
          if (deletedBlockIds.includes(b.id)) return false
          const links = parseBlockLinks(b.content)
          return links.some(l =>
            !l.isExternal &&
            l.targetTitle === targetTitle &&
            l.relationshipType !== null
          )
        })
        if (stillHasTypedLink) {
          survivingTypedLinks.add(targetTitle)
        }
      }
    }

    // 4. 一次性批量删除所有块（含子孙节点）
    await blockStore.deleteBlocks(deletedBlockIds)

    // 交还给浏览器：让 Vue flush 完 reactive 更新、DOM paint 之后，再继续跨页清理
    await 0

    if (!ourPageTitle) return result

    // 5. 跨页清理：对每个目标，如果没有同页 surviving typed-link 维持，则降级反向引用
    for (const [targetTitle, inverseType] of targetSet) {
      if (survivingTypedLinks.has(targetTitle)) continue

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
