import { useBlockStore } from '../stores/blocks'
import { usePageStore } from '../stores/pages'
import { getCoreClient } from '../wasm/client'
import { applyRelationshipTypeToBlockContent } from './useRelationshipSync'
import type { LinkDraft } from '../wasm/types'

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
 * 内容级操作计划（#100）：描述「部分消失」的内容，让清理的判定口径从
 * 「哪些块被删」升级为「操作后本页还剩哪些 typed-link」。
 *
 * - `vanishedFragments`：块上被裁掉、随之消失的文本片段（无论宿主块存亡）——
 *   目标提取的额外输入。片段按字面参与提取，截断到链接语法中间时自然不匹配
 *   （最坏漏摘，方向安全）。
 * - `contentAfter`：存活但内容被裁的块 → 操作后的最终内容——存活检查以此
 *   替代旧内容，否则被裁掉的链接会被误判为「仍有存活维持」（漏降级的另一半）。
 * - `removedBlockIds`：块本身消失但内容部分转移（如文本选区合并的 source 块）——
 *   从存活检查排除；其目标提取**只认** vanishedFragments，绝不按整块内容提取
 *   （转移存活的部分会假降级）。
 */
export interface CleanupContentPlan {
  removedBlockIds?: string[]
  vanishedFragments?: Array<{ blockId: string; text: string }>
  contentAfter?: Record<string, string>
}

/**
 * Block 删除后的语义关系整理 composable (4.3: migrated from TS parser to Rust)
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
 * - 仅处理带 inverseRelationshipType 的 link（单向 ((depends-on)) 不参与）
 * - 同页其他 block 仍含 typed-link 到目标 → 跳过
 * - 跨页降级保留 [[link]] 本身，只移除 ((...)) 部分
 */
export function useBlockRelationshipCleanup() {
  const blockStore = useBlockStore()
  const pageStore = usePageStore()

  /**
   * 在一组 Block 被删除后，整理它们涉及到的语义关系。
   *
   * @param pageId 被删 block 所属页的 pageId
   * @param deletedBlockIds 被删除（整块消失）的 block ID 集合
   * @param blocksBeforeDelete 删除前的块快照（调用方在变更前捕获）
   * @param plan 内容级操作计划（#100）：描述「部分消失」的内容，使存活判定
   *   基于操作后的内容而非被删块 id 集合。不传时行为与旧口径完全一致。
   */
  async function cleanupAfterDelete(
    pageId: string,
    deletedBlockIds: string[],
    blocksBeforeDelete?: Array<ReturnType<typeof useBlockStore>['blocks'][0]>,
    plan?: CleanupContentPlan
  ): Promise<CleanupResult> {
    const result: CleanupResult = {
      modifiedCrossPageBlocks: [],
      orphanedTargets: []
    }

    const hasPlan = !!(plan && (plan.removedBlockIds?.length || plan.vanishedFragments?.length || plan.contentAfter && Object.keys(plan.contentAfter).length > 0))
    if (deletedBlockIds.length === 0 && !hasPlan) return result

    // 在删除前保存 blocks 的快照，因为删除后 blockStore.blocks 会改变！
    const blocks = blocksBeforeDelete ?? [...blockStore.blocks]

    // 1. 收集被删 blocks 中带 inverse 的 typed-link 目标（去重）
    // targetTitle -> inverseType
    const targetSet = new Map<string, string>()
    for (const id of deletedBlockIds) {
      const block = blocks.find(b => b.id === id)
      if (!block) continue
      const links: LinkDraft[] = await getCoreClient()!.extractLinksFromContent(block.content)
      for (const link of links) {
        if (link.is_external) continue
        if (link.relationship_type === null) continue
        if (link.inverse_relationship_type === null) continue
        targetSet.set(link.target_title, link.inverse_relationship_type)
      }
    }
    // 1b. 部分消失的片段同样参与目标提取（宿主块可能存活，整块内容不可用）
    if (plan?.vanishedFragments) {
      for (const fragment of plan.vanishedFragments) {
        if (!fragment.text) continue
        const links: LinkDraft[] = await getCoreClient()!.extractLinksFromContent(fragment.text)
        for (const link of links) {
          if (link.is_external) continue
          if (link.relationship_type === null) continue
          if (link.inverse_relationship_type === null) continue
          targetSet.set(link.target_title, link.inverse_relationship_type)
        }
      }
    }

    // 2. 跨页清理准备：解析当前 pageId 对应的 title
    const ourPageTitle = pageStore.pages.find(p => p.id === pageId)?.title ?? null

    // 3. 检查本页 SURVIVING blocks 是否仍含 typed-link 维持（关键：在删除之前！）。
    //    存活判定按「操作后内容」：被删/消失块排除，被裁块用裁后内容（plan.contentAfter）。
    const excludedIds = new Set([...deletedBlockIds, ...(plan?.removedBlockIds ?? [])])
    const survivingTypedLinks = new Set<string>()
    if (ourPageTitle) {
      for (const [targetTitle] of targetSet) {
        let stillHasTypedLink = false
        for (const b of blocks) {
          if (b.pageId !== pageId) continue
          if (excludedIds.has(b.id)) continue
          const content = plan?.contentAfter?.[b.id] ?? b.content
          const links: LinkDraft[] = await getCoreClient()!.extractLinksFromContent(content)
          if (links.some(l =>
            !l.is_external &&
            l.target_title === targetTitle &&
            l.relationship_type !== null
          )) {
            stillHasTypedLink = true
            break
          }
        }
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

      // 跨页降级：扫描目标页面所有 blocks，移除 [[ourPageTitle]]((...)) 类型后缀
      result.orphanedTargets.push({ targetTitle, inverseType })

      const targetPageId = pageStore.pages.find(p => p.title === targetTitle)?.id
      if (!targetPageId) continue

      const targetBlocks = blockStore.blocks.filter(b => b.pageId === targetPageId)
      for (const tb of targetBlocks) {
        const newContent = await applyRelationshipTypeToBlockContent(tb.content, ourPageTitle, null)
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
