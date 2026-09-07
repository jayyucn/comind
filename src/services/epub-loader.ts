// EPUB 加载共享模块（票 01 导入 / 票 03 阅读器共用）：
// fflate 解 zip 构造 foliate-js 的加载层（loadText/loadBlob/getSize），
// EPUB 解析（sections/TOC/元数据/资源）全部在内存完成，不落中间文件（ADR-0040 D8）。
// 阅读器侧按书 Page id 经 read_book_file 读取 workspace/books/<id>.epub。
import { invoke } from '@tauri-apps/api/core'
import { unzip, strFromU8 } from 'fflate'
import { EPUB } from 'foliate-js/epub.js'
import type { EPUBLoader } from 'foliate-js/epub.js'

/** fflate 解 zip，构造 foliate-js EPUB 需要的加载层（loadText/loadBlob 返回 null 表示条目不存在） */
export async function makeEpubLoader(blob: Blob): Promise<EPUBLoader> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) =>
    unzip(bytes, (err, data) => (err ? reject(err) : resolve(data))),
  )
  return {
    loadText: (uri: string) => (uri in entries ? strFromU8(entries[uri]) : null),
    // 复制一份绕开 fflate 的 Uint8Array<ArrayBufferLike> 与 BlobPart 的泛型不兼容
    loadBlob: (uri: string) =>
      uri in entries ? new Blob([new Uint8Array(entries[uri])]) : null,
    getSize: (uri: string) => entries[uri]?.length ?? 0,
  }
}

/** 从 Blob 解析 EPUB（导入链路与阅读器共用的解析入口）；损坏文件抛错 */
export async function loadEpub(blob: Blob): Promise<EPUB> {
  const loader = await makeEpubLoader(blob)
  return new EPUB(loader).init()
}

/**
 * 阅读器入口：按书 Page id 读取 workspace/books/<id>.epub 并解析。
 * 书文件缺失（票 01 已知让步：落盘失败不回滚 Page）或文件损坏时抛错，
 * 由调用方（ReaderView）显示友好错误态兜底。
 */
export async function loadEpubFromStorage(bookId: string): Promise<EPUB> {
  const bytes = await invoke<number[]>('read_book_file', { id: bookId })
  if (!bytes || bytes.length === 0) {
    throw new Error('书文件为空或不存在')
  }
  return loadEpub(new Blob([new Uint8Array(bytes)]))
}

/** foliate-js 的语言映射形态（{ lang: text }）→ 展示字符串（取首个值，同官方 demo） */
export function formatLanguageMap(x: unknown): string {
  if (!x) return ''
  if (typeof x === 'string') return x
  if (typeof x === 'object') {
    const map = x as Record<string, unknown>
    const first = Object.keys(map)[0]
    return first ? String(map[first] ?? '') : ''
  }
  return ''
}
