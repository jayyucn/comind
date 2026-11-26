/**
 * 网页链接 chip 的动作执行层（ADR-0067）。
 *
 * 悬浮条只上报意图；本模块负责改 content / 拆建块 / 抓取元数据。
 * 所有块操作走 blockStore 的既有收口（撤销栈、保存、标签同步不绕过）。
 */
import { useBlockStore } from '../stores/blocks'
import { useEditorStore } from '../stores/editor'
import { DEFAULT_PREVIEW_HEIGHT, patchWebLink, WEB_LINK_TYPE, type WebLinkView } from '../utils/web-link'
import { findWebLinkChips, replaceWebLinkChip, webLinkChipMarkdown, webLinkChipOnly } from '../utils/web-link-chip'
import { planCardToChip, planChipToCard } from './web-link-split'

/** 编辑链接：改 chip 的标题与 URL（content 字面改写） */
export async function editChipLink(blockId: string, title: string, url: string): Promise<boolean> {
  const store = useBlockStore()
  const block = store.getBlock(blockId)
  if (!block) return false
  const chip = webLinkChipOnly(block.content)
  if (!chip) return false
  const next = webLinkChipMarkdown(title || url, url)
  if (next !== block.content) await store.updateBlockContent(blockId, next)
  return true
}

/** 移除链接：chip 变普通文本（保留标题文字），URL 丢弃（进撤销栈） */
export async function removeChipLink(blockId: string, start: number, end: number, title: string): Promise<boolean> {
  const store = useBlockStore()
  const block = store.getBlock(blockId)
  if (!block) return false
  const chip = findWebLinkChips(block.content).find(c => c.start === start && c.end === end)
  if (!chip) return false
  await store.updateBlockContent(blockId, replaceWebLinkChip(block.content, chip, title))
  return true
}

/** 复制原始链接（悬浮条的复制项） */
export async function copyWebLinkUrl(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = url
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
}

/** chip → 卡片/预览：拆旧建新 */
export async function convertChipToCard(
  blockId: string,
  view: 'card' | 'preview',
): Promise<string | null> {
  const store = useBlockStore()
  const editor = useEditorStore()
  const block = store.getBlock(blockId)
  if (!block) return null
  const chip = webLinkChipOnly(block.content)
  if (!chip) return null

  editor.deactivateBlock()
  const plan = planChipToCard({
    content: block.content,
    start: chip.start,
    end: chip.end,
    title: chip.title,
    url: chip.url,
    pos: block.pos,
  })

  // 前文本：保留原块（如有子块/字段，跟着原块走）或清空 content
  if (plan.keepAsBefore) {
    await store.updateBlockContent(blockId, plan.before)
  }
  // web-link 块插在原块之后
  const cardFormat = {
    link: {
      view,
      previewHeight: DEFAULT_PREVIEW_HEIGHT,
      meta: { title: plan.title, domain: new URL(plan.url).hostname.replace(/^www\./, '') },
    },
  }
  const card = await store.createBlock({
    pageId: block.pageId,
    parentId: block.parentId,
    content: plan.url,
    type: WEB_LINK_TYPE,
    format: cardFormat,
    pos: plan.pos + 1,
  })
  // 后文本块
  if (plan.after.trim()) {
    await store.createBlock({
      pageId: block.pageId,
      parentId: block.parentId,
      content: plan.after,
      type: 'text',
      format: { ...block.format },
      pos: plan.pos + 2,
    })
  }
  return card.id
}

/** 卡片/预览 → chip：合并前后文本，删 web-link 块 */
export async function convertCardToChip(blockId: string): Promise<string | null> {
  const store = useBlockStore()
  const editor = useEditorStore()
  const block = store.getBlock(blockId)
  if (!block || block.type !== WEB_LINK_TYPE) return null
  const url = block.content.trim()
  if (!/^https?:\/\//.test(url)) return null

  const siblings = store.getBlocksByPage(block.pageId)
    .filter(b => b.parentId === block.parentId)
    .sort((a, b) => a.pos - b.pos)
  const idx = siblings.findIndex(b => b.id === blockId)
  const before = idx > 0 && siblings[idx - 1].type === 'text' ? siblings[idx - 1] : undefined
  const after = idx >= 0 && idx < siblings.length - 1 && siblings[idx + 1].type === 'text' ? siblings[idx + 1] : undefined
  const meta = (block.format?.link as { meta?: { title?: string } } | undefined)?.meta
  const title = meta?.title || new URL(url).hostname.replace(/^www\./, '')

  const plan = planCardToChip({
    url,
    title,
    beforeContent: before?.content,
    beforeId: before?.id,
    afterContent: after?.content,
    afterId: after?.id,
  })

  editor.deactivateBlock()
  // 用原 web-link 块就地改回 text：保住 id / 反链 / 位置
  await store.updateBlockType(blockId, 'text')
  await store.updateBlockContent(blockId, plan.content)
  await store.updateBlockFormat(blockId, {})
  for (const id of plan.removeIds) await store.deleteBlocks([id])
  return blockId
}

/** 标题视图 alias 的异步填充：抓取成功才换，用户改过则不覆盖 */
export async function fillChipAliasIfUnlocked(blockId: string, url: string, fetchedTitle: string): Promise<void> {
  const store = useBlockStore()
  const block = store.getBlock(blockId)
  if (!block) return
  const chip = webLinkChipOnly(block.content)
  if (!chip || chip.url !== url) return
  // 只有 alias 仍是「域名占位」时才填网页标题；用户改过任何字都保住
  const domain = new URL(url).hostname.replace(/^www\./, '')
  if (chip.title !== domain && chip.title !== url) return
  if (chip.title === fetchedTitle) return
  await store.updateBlockContent(blockId, replaceWebLinkChip(block.content, chip, webLinkChipMarkdown(fetchedTitle, url)))
}

/** 悬浮条视图切换的统入口：chip ↔ 卡片/预览 */
export async function switchWebLinkView(
  blockId: string,
  target: WebLinkView,
  hostKind: 'chip' | 'block',
): Promise<string | undefined> {
  const store = useBlockStore()
  if (hostKind === 'chip') {
    if (target === 'link' || target === 'title') return blockId
    return (await convertChipToCard(blockId, target)) ?? undefined
  }
  const block = store.getBlock(blockId)
  if (!block) return undefined
  if (target === 'card' || target === 'preview') {
    await store.updateBlockFormat(blockId, patchWebLink(block.format, { view: target }))
    return blockId
  }
  return (await convertCardToChip(blockId)) ?? undefined
}
