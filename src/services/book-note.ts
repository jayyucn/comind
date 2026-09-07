// 写笔记业务（票 06 / ADR-0040 D3/D4/D7）：高亮升格为知识库 Block。
// 阅读器窗口（独立 WebView，经 wasm client 直写同一 SQLite）调用的写路径：
// 新建 → 书 Page 根级 append bullet Block（content=想法）+ 书笔记属性
// book/part/chapter/cfi/quote + 回填高亮行 block_id（upsert 全量，ON CONFLICT 更新）；
// 更新 → 已有 block_id 的高亮再写，只改同一条 Block 的 content（#9 语义）；
// 删除 → 高亮行与其笔记 Block 联动删除（delete_block_cascade，不留孤儿块）。
// 写入/删除成功后 emitTo 主窗口 'reader:data-changed'（主窗口重载对应 page
// blocks，ADR-0040 D4：独立 WebView = 独立 Pinia 内存态，跨窗口事件刷新）。
import { emitTo } from '@tauri-apps/api/event'
import { useBlockStore } from '../stores/blocks'
import { usePropertyStore } from '../stores/property'
import { initCoreClient, isTauriEnvironment } from '../wasm/client'
import type { BookHighlightRust } from '../wasm/types'

/** 写笔记入参：高亮上下文 + 想法文本 */
export interface NoteInput {
  /** 书 Page id（笔记 Block 的挂载页） */
  bookPageId: string
  /** 书名（book 属性，笔记脱离书文件可读） */
  bookTitle: string
  /** 父级章节名快照（卷/部，双层结构时保存为 part 属性） */
  parentChapter?: string
  /** 章节名快照 */
  chapter: string
  /** 高亮 CFI 锚点 */
  cfi: string
  /** 高亮原文（quote 属性） */
  quote: string
  /** 想法文本（Block content） */
  text: string
  /** 高亮行（新建路径回填 block_id 的目标） */
  highlight: BookHighlightRust
}

/** 通知主窗口重载对应 page blocks（尽力而为：失败静默，focus 时有兜底刷新） */
async function notifyMainWindowChanged(bookPageId: string): Promise<void> {
  if (!isTauriEnvironment()) return
  try {
    await emitTo('main', 'reader:data-changed', { pageId: bookPageId })
  } catch (e) {
    console.warn('[reader] 跨窗口刷新通知失败:', e)
  }
}

/**
 * 创建（或更新）笔记 Block。
 *
 * - highlight.block_id 为空 → 新建：先加载该书 Page 现有 blocks（末尾 append
 *   的 pos 基准，避免与库中已有 block 的 pos 冲突），createBlock 后 flushSave
 *   先落库再写属性（Property 表引用 block 的外键约束，pasteBlocks 同款次序），
 *   最后全量 upsert 回填高亮行 block_id。
 * - highlight.block_id 已有 → 更新：loadBlock 拉库进缓存（阅读器窗口内存无此
 *   block），updateBlockContent 改 content 后 flushSave 立即持久化。
 */
export async function createOrUpdateNoteBlock(
  input: NoteInput,
): Promise<{ blockId: string; created: boolean; highlight: BookHighlightRust }> {
  const blockStore = useBlockStore()
  const propertyStore = usePropertyStore()

  if (input.highlight.block_id) {
    const blockId = input.highlight.block_id
    await blockStore.loadBlock(blockId)
    await blockStore.updateBlockContent(blockId, input.text)
    await blockStore.flushSave(blockId)
    await notifyMainWindowChanged(input.bookPageId)
    return { blockId, created: false, highlight: input.highlight }
  }

  // 新建：先读该书 Page 现有 blocks（append 末尾 + 后续 upsert 回填的基准）
  await blockStore.loadPageBlocks(input.bookPageId)
  const block = await blockStore.createBlock({
    pageId: input.bookPageId,
    content: input.text,
    parentId: null,
    type: 'bullet',
  })
  // 先落库再写属性（Property 表有 block 外键约束）
  await blockStore.flushSave(block.id)
  await propertyStore.setProperty(block.id, 'book', input.bookTitle, 'string')
  if (input.parentChapter) {
    await propertyStore.setProperty(block.id, 'part', input.parentChapter, 'string')
  }
  await propertyStore.setProperty(block.id, 'chapter', input.chapter, 'string')
  await propertyStore.setProperty(block.id, 'cfi', input.cfi, 'string')
  await propertyStore.setProperty(block.id, 'quote', input.quote, 'string')

  // 回填高亮行 block_id：全量 upsert 带原 id（SQL ON CONFLICT 更新，保留首插 created_at）
  const client = await initCoreClient()
  const updated = await client.upsertBookHighlight({
    ...input.highlight,
    block_id: block.id,
    updated_at: Date.now(),
  })

  await notifyMainWindowChanged(input.bookPageId)
  return { blockId: block.id, created: true, highlight: updated }
}

/** 读取已有笔记 Block 的当前文本（「再写」时输入浮层预填） */
export async function loadNoteText(blockId: string): Promise<string> {
  const block = await useBlockStore().loadBlock(blockId)
  return block?.content ?? ''
}

/**
 * 删除高亮行，并联动删除其关联的笔记 Block（Rust delete_block_cascade：
 * Block 及其属性/子节点一并删除），避免书 Page 留下孤儿块。
 * 高亮行删除失败时不触碰 Block（保持两者一致）；成功后通知主窗口刷新书 Page。
 */
export async function deleteNoteHighlight(
  bookPageId: string,
  highlight: BookHighlightRust,
): Promise<void> {
  const client = await initCoreClient()
  await client.deleteBookHighlight(highlight.id)
  if (highlight.block_id) {
    await client.deleteBlock(highlight.block_id)
  }
  await notifyMainWindowChanged(bookPageId)
}
