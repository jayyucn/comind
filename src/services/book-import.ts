// EPUB 导入链路 → 书记录（票 01 / ADR-0040 D2/D3/D8）：
// 选文件 → 解析元数据（foliate-js epub.js，内存中）→ 封面一次性提取存 asset
// → 创建 type='book' 的 Page（走现有 page 写路径，进 sync 表照常同步）
// → 书原文件落 workspace/books/<pageId>.epub（阅读器按 bookId 直接定位，见票 03）。
// zip 加载层与 EPUB 解析抽在 epub-loader.ts（与阅读器共用）。
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { readFile } from '@tauri-apps/plugin-fs'
import { assetStorage } from '../utils/asset'
import { initCoreClient, isTauriEnvironment } from '../wasm/client'
import type { Page } from '../wasm/types'
import { formatLanguageMap, loadEpub } from './epub-loader'

/** 封面 MIME → 扩展名（存 asset 时确定磁盘文件名的扩展名段） */
const COVER_MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
}

/** 贡献者（字符串 | { name } | 数组）→ 展示字符串（多作者逗号连接，同官方 demo 逻辑） */
function formatContributor(x: unknown): string {
  if (Array.isArray(x)) return x.map(formatContributor).filter(Boolean).join('，')
  if (typeof x === 'string') return x
  return formatLanguageMap((x as { name?: unknown } | null)?.name)
}

/**
 * 导入一本 EPUB 为书记录。
 *
 * - 用户取消对话框时返回 null；解析/写入失败向上抛错。
 * - 重复导入同一本书不做去重（v1 记录在案）；注意核心层 Page 有 UNIQUE(title)
 *   约束且按标题幂等，同名书会复用已有 Page 并覆盖书文件。
 * - 书文件落盘失败时不回滚 Page：savePage 按标题幂等，返回的可能是导入前
 *   就存在的 Page，回滚会误删用户数据（阅读器侧需兜底缺文件的情况）。
 */
export async function importEpub(): Promise<Page | null> {
  if (!isTauriEnvironment()) {
    throw new Error('EPUB 导入仅支持桌面端')
  }

  // 1. 原生文件对话框选 .epub（webview 内 <input type=file> 不可靠，参照 imagePicker）
  const selected = await open({
    multiple: false,
    title: '导入 EPUB',
    filters: [{ name: 'EPUB 电子书', extensions: ['epub'] }],
  })
  if (typeof selected !== 'string') return null

  // 2. 读文件字节，内存中解析元数据（不依赖落盘顺序）
  const bytes = await readFile(selected)
  const fileName = selected.split(/[\\/]/).pop() || 'book.epub'
  const book = await loadEpub(new Blob([bytes]))

  const title = formatLanguageMap(book.metadata?.title).trim() || fileName.replace(/\.epub$/i, '')
  const author = formatContributor(book.metadata?.author).trim()

  // 3. 封面一次性提取 → asset（书房网格经 asset:// 引用展示）
  let cover: string | null = null
  const coverBlob = await book.getCover()
  if (coverBlob && coverBlob.size > 0) {
    const ext = COVER_MIME_EXT[coverBlob.type] ?? 'png'
    const asset = await assetStorage.save(
      new File([coverBlob], `cover.${ext}`, { type: coverBlob.type }),
    )
    cover = `asset://${asset.id}`
  }

  // 4. 创建 type='book' 的书 Page（标题/封面/作者别名；作者进 aliases）
  const client = await initCoreClient()
  const page = await client.savePage({
    title,
    type: 'book',
    cover,
    aliases: author ? JSON.stringify([author]) : undefined,
  })

  // 5. 书原文件以 Page id 落 workspace/books/<id>.epub
  await invoke('save_book_file', { id: page.id, data: Array.from(bytes) })

  return page
}
