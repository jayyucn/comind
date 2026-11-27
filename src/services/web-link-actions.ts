/**
 * 网页链接 chip 的动作执行层（ADR-0067）。
 *
 * 悬浮条只上报意图；本模块负责改 content / 拆建块 / 抓取元数据。
 * 所有块操作走 blockStore 的既有收口（撤销栈、保存、标签同步不绕过）。
 */
import { useBlockStore } from '../stores/blocks'
import { useEditorStore } from '../stores/editor'
import { DEFAULT_PREVIEW_HEIGHT, domainOf, patchWebLink, WEB_LINK_TYPE, type WebLinkView } from '../utils/web-link'
import { chipAliasForView, chipMetaTitleOf, findWebLinkChip, findWebLinkChips, replaceWebLinkChip, webLinkChipMarkdown, webLinkChipOnly } from '../utils/web-link-chip'
import { buildMergedChipSegments, patchChipRewrite, splitChipSegments } from '../utils/web-link-segments'
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
  const literal = webLinkChipMarkdown(title || url, url)
  const next = replaceWebLinkChip(block.content, chip, literal)
  if (next !== block.content) {
    // 本地补段：改写后的 chip 段与 content 同拍写入，读态不闪裸 markdown
    // （save 返回的 Rust 段随后覆盖；补段失败返回 undefined = 保持清段回退）
    const segs = block.renderSegments
      ? patchChipRewrite(block.renderSegments, chip.start, chip.end, literal, next.length, { url, displayText: title || url })
      : null
    await store.updateBlockContent(blockId, next, segs ? { renderSegments: segs } : undefined)
  }
  return true
}

/** 移除链接：chip 变普通文本（保留标题文字），URL 丢弃（进撤销栈） */
export async function removeChipLink(blockId: string, start: number, end: number, title: string): Promise<boolean> {
  const store = useBlockStore()
  const block = store.getBlock(blockId)
  if (!block) return false
  const chip = findWebLinkChips(block.content).find(c => c.start === start && c.end === end)
  if (!chip) return false
  const next = replaceWebLinkChip(block.content, chip, title)
  const segs = block.renderSegments
    ? patchChipRewrite(block.renderSegments, start, end, title, next.length)
    : null
  await store.updateBlockContent(blockId, next, segs ? { renderSegments: segs } : undefined)
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
  // 本地补段：拆出的前/后文本块段由旧段按 chip 边界切出（null = 补不了，保持清段回退）
  const split = block.renderSegments
    ? splitChipSegments(block.renderSegments, chip.start, chip.end)
    : null

  // 前文本：保留原块（如有子块/字段，跟着原块走）或清空 content
  if (plan.keepAsBefore) {
    await store.updateBlockContent(blockId, plan.before, split ? { renderSegments: split.before } : undefined)
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
      renderSegments: split ? split.after : undefined,
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
  // 落到哪个文本视图由这次点击决定；别名与 chip 视图同一条回退链（meta.title → 域名 → URL）
  const archiveTitle = meta?.title?.trim()
  const title = chipAliasForView(url, target, archiveTitle)

  const plan = planCardToChip({
    url,
    title,
    beforeContent: before?.content,
    beforeId: before?.id,
    afterContent: after?.content,
    afterId: after?.id,
  })

  editor.deactivateBlock()
  // 本地补段：合并 content 的段 = 前文本段 + 新 chip 段 + 后文本段（邻居缺段则 null 回退）
  const chipLiteral = `[${title}](${url})`
  const mergedSegs = buildMergedChipSegments(
    before ? { segs: before.renderSegments, length: before.content.length } : undefined,
    after ? { segs: after.renderSegments, length: after.content.length } : undefined,
    chipLiteral,
    url,
    title,
    plan.content.length,
  )
  // 用原 web-link 块就地改回 text：保住 id / 反链 / 位置
  await store.updateBlockType(blockId, 'text')
  await store.updateBlockContent(blockId, plan.content, mergedSegs ? { renderSegments: mergedSegs } : undefined)
  // meta.title 存档进 chip 侧格式：之后切标题视图从这里取（meta.title === URL 不入档，
  // 字面 title === url 会被判成链接视图，见 chipAliasForView）
  const webLinkMetas = archiveTitle && archiveTitle !== url
    ? { ...((block.format?.webLinkMetas as Record<string, string> | undefined) ?? {}), [url]: archiveTitle }
    : ((block.format?.webLinkMetas as Record<string, string> | undefined) ?? {})
  await store.updateBlockFormat(blockId, { webLinkMetas })
  for (const id of plan.removeIds) await store.deleteBlocks([id])
  return blockId
}

/**
 * 抓取成功的收口：存档 meta.title + 占位别名跟随。
 *
 * 存档（`format.webLinkMetas[url]`）无条件更新——它是之后切标题视图的别名单源。
 * alias 本身只在仍是「占位」时跟随抓取结果：占位 = 域名 / URL / 上次存档的
 * meta.title。用户手动改过任何字都不属于占位，抓取永不覆盖（ADR-0067 锁定）。
 * 占位含旧存档意味着：站点改了标题、用户没动过别名时，重抓会跟踪新标题。
 */
export async function applyFetchedChipMeta(blockId: string, url: string, fetchedTitle: string): Promise<void> {
  const store = useBlockStore()
  const block = store.getBlock(blockId)
  if (!block) return

  const archive = chipMetaTitleOf(block.format, url)
  const existingMetas = (block.format.webLinkMetas as Record<string, string> | undefined) ?? {}
  if (archive !== fetchedTitle) {
    await store.updateBlockFormat(blockId, { webLinkMetas: { ...existingMetas, [url]: fetchedTitle } })
  }

  const chip = findWebLinkChip(block.content, { url })
  if (!chip) return
  const domain = domainOf(url)
  const isPlaceholder = chip.title === domain || chip.title === url || (archive !== undefined && chip.title === archive)
  if (!isPlaceholder || chip.title === fetchedTitle) return
  const literal = webLinkChipMarkdown(fetchedTitle, url)
  const next = replaceWebLinkChip(block.content, chip, literal)
  const segs = block.renderSegments
    ? patchChipRewrite(block.renderSegments, chip.start, chip.end, literal, next.length, { url, displayText: fetchedTitle })
    : null
  await store.updateBlockContent(blockId, next, segs ? { renderSegments: segs } : undefined)
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
  // 标题视图别名走存档回退链 meta.title → 域名 → URL（ADR-0067）
  const alias = chipAliasForView(chip.url, target, chipMetaTitleOf(block.format, chip.url))
  if (alias === chip.title) return blockId
  const literal = webLinkChipMarkdown(alias, chip.url)
  const next = replaceWebLinkChip(block.content, chip, literal)
  const segs = block.renderSegments
    ? patchChipRewrite(block.renderSegments, chip.start, chip.end, literal, next.length, { url: chip.url, displayText: alias })
    : null
  await store.updateBlockContent(blockId, next, segs ? { renderSegments: segs } : undefined)
  return blockId
}
