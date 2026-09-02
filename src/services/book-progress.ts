// 书房卡片进度（票 08 / ADR-0040 D6/D9）：阅读进度 CFI → 章节粒度近似百分比。
// 进度表存的是上次位置的文字级 CFI（epubcfi(/6/N!/…)），v1 不做文字级解析，
// 仅从 CFI 前缀反推 spine 章节下标（foliate-js 约定 N = (章节下标 + 1) * 2，
// 见 foliate-js epubcfi.js 的 fake.fromIndex），再按 (章节下标+1)/总章数 近似百分比。
import { initCoreClient } from '../wasm/client'
import { isTauriEnvironment } from '../wasm/tauri-platform'
import { loadEpubFromStorage } from './epub-loader'

/** 进度 CFI 的 spine 前缀：epubcfi(/6/N…，N 为 package document 内 itemref 的偶数步号 */
const SPINE_CFI_PREFIX = /^epubcfi\(\/6\/(\d+)/

/**
 * 从进度 CFI 解析 spine 章节下标。
 * foliate-js 的 spine 定位前缀为 epubcfi(/6/N)，其中 N = (章节下标 + 1) * 2。
 * 无法解析（空/非 CFI/步号缺失或非法）返回 null。
 */
export function sectionIndexFromCfi(cfi: string | null | undefined): number | null {
  if (!cfi) return null
  const m = cfi.match(SPINE_CFI_PREFIX)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n) || n < 2) return null
  return Math.floor(n / 2) - 1
}

/**
 * 章节下标 → 阅读进度近似百分比（0~1，票 08 v1 章节粒度近似）。
 * 进度锚定在 index 章内，取 (index+1)/总章数 作为近似；
 * 总章数非法返回 null；下标越界（含负数）钳制到 [0, total-1]。
 */
export function sectionProgressPercent(sectionIndex: number, totalSections: number): number | null {
  if (!Number.isFinite(sectionIndex) || !Number.isFinite(totalSections) || totalSections <= 0) return null
  const idx = Math.min(Math.max(Math.floor(sectionIndex), 0), totalSections - 1)
  return (idx + 1) / totalSections
}

/** 进度 CFI + 总章数 → 近似百分比；无进度/无法解析返回 null（卡片显示无进度态）。 */
export function progressPercentFromCfi(
  cfi: string | null | undefined,
  totalSections: number,
): number | null {
  const idx = sectionIndexFromCfi(cfi)
  if (idx === null) return null
  return sectionProgressPercent(idx, totalSections)
}

/** 每本书的 spine 总章数缓存（会话级）：避免书房每次挂载都重新解压解析书文件。 */
const sectionCountCache = new Map<string, number>()

/** 某本书的 spine 总章数（经 epub-loader 解析；会话内缓存）。 */
async function totalSectionsOf(bookId: string): Promise<number> {
  const cached = sectionCountCache.get(bookId)
  if (cached != null) return cached
  const book = await loadEpubFromStorage(bookId)
  const total = book.sections.length
  sectionCountCache.set(bookId, total)
  return total
}

/**
 * 批量加载书房网格所需的阅读进度（bookPageId → 0~1 百分比）。
 * 仅桌面端调用（进度表与书文件均为桌面本地，ADR-0040 D5/D8）；
 * 单本书失败（书文件缺失/损坏，票 01 已知让步）仅跳过其进度环，不影响其余书。
 */
export async function loadBookGalleryProgress(bookIds: string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {}
  if (!isTauriEnvironment() || bookIds.length === 0) return result
  const client = await initCoreClient()
  for (const bookId of bookIds) {
    try {
      const progress = await client.getBookProgress(bookId)
      if (!progress?.cfi) continue
      const percent = progressPercentFromCfi(progress.cfi, await totalSectionsOf(bookId))
      if (percent !== null) result[bookId] = percent
    } catch (e) {
      console.warn('[book-progress] 跳过进度加载失败的书籍:', bookId, e)
    }
  }
  return result
}
