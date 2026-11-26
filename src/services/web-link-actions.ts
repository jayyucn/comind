/**
 * 网页链接 chip 的动作执行层（ADR-0067）。
 *
 * 悬浮条只上报意图；本模块负责改 content / 拆建块 / 抓取元数据。
 * 所有块操作走 blockStore 的既有收口（撤销栈、保存、标签同步不绕过）。
 */
import { useBlockStore } from '../stores/blocks'
import { useEditorStore } from '../stores/editor'
import { DEFAULT_PREVIEW_HEIGHT, domainOf, patchWebLink, WEB_LINK_TYPE, type WebLinkView } from '../utils/web-link'
import { chipAliasForView, findWebLinkChip, findWebLinkChips, replaceWebLinkChip, webLinkChipMarkdown, webLinkChipOnly } from '../utils/web-link-chip'
import { planCardToChip, planChipToCard } from './web-link-split'

/** 定位目标 chip 的锚：悬浮条手里只有从 DOM 读来的 url / 标题 */
type ChipMatch = { url: string; title?: string }

function locateChip(content: string, match?: ChipMatch) {
  return match ? findWebLinkChip(content, match) : webLinkChipOnly(content)
}

/** 编辑链接：改 chip 的标题与 URL（content 字面改写，块内前后文本原样保留） */
export async function editChipLink(
  blockId: string,
  match: ChipMatch,
  title: string,
  url: string,
): Promise<boolean> {
  const store = useBlockStore()
  const block = store.getBlock(blockId)
  if (!block) return false
  const chip = locateChip(block.content, match)
  if (!chip) return false
  const next = replaceWebLinkChip(block.content, chip, webLinkChipMarkdown(title || url, url))
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

/** chip → 卡片/预览：拆旧建新（块内前后文本各拆成独立块） */
export async function convertChipToCard(
  blockId: string,
  view: 'card' | 'preview',
  match?: ChipMatch,
): Promise<string | null> {
  const store = useBlockStore()
  const editor = useEditorStore()
  const block = store.getBlock(blockId)
  if (!block) return null
  const chip = locateChip(block.content, match)
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
      meta: { title: plan.title, domain: domainOf(plan.url) },
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
  // 整块正文都搬进了卡片：原块只剩空壳，必须收拾掉，否则页面上会同时留下
  // 一份 chip 和一张卡片（重复内容）。有子块时改清空，不动子树。
  if (!plan.keepAsBefore) {
    if (store.getChildren(blockId).length === 0) await store.deleteBlocks([blockId])
    else await store.updateBlockContent(blockId, '')
  }
  return card.id
}

/** 卡片/预览 → chip：合并前后文本，删 web-link 块 */
export async function convertCardToChip(
  blockId: string,
  target: 'link' | 'title' = 'title',
): Promise<string | null> {
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
  // 落到哪个文本视图由这次点击决定：链接视图写 URL 原文，标题视图写网页标题（退域名）
  const title = target === 'link'
    ? url
    : (meta?.title?.trim() || domainOf(url) || url)

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
  const chip = findWebLinkChip(block.content, { url })
  if (!chip) return
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
  chip?: ChipMatch,
): Promise<string | undefined> {
  const store = useBlockStore()
  if (hostKind === 'chip') {
    if (target === 'card' || target === 'preview') {
      return (await convertChipToCard(blockId, target, chip)) ?? undefined
    }
    // 链接视图 / 标题视图 = 别名字面，不是 format 里的开关（ADR-0067 D1）
    return await switchChipTextView(blockId, target, chip)
  }
  const block = store.getBlock(blockId)
  if (!block) return undefined
  if (target === 'card' || target === 'preview') {
    await store.updateBlockFormat(blockId, patchWebLink(block.format, { view: target }))
    return blockId
  }
  return (await convertCardToChip(blockId, target)) ?? undefined
}

/** chip 在「链接视图 ↔ 标题视图」之间切换：只改别名字面，URL 不动 */
export async function switchChipTextView(
  blockId: string,
  target: 'link' | 'title',
  match?: ChipMatch,
): Promise<string | undefined> {
  const store = useBlockStore()
  const block = store.getBlock(blockId)
  if (!block) return undefined
  const chip = locateChip(block.content, match)
  if (!chip) return undefined
  const alias = chipAliasForView(chip.url, target)
  if (alias === chip.title) return blockId
  await store.updateBlockContent(
    blockId,
    replaceWebLinkChip(block.content, chip, webLinkChipMarkdown(alias, chip.url)),
  )
  return blockId
}
