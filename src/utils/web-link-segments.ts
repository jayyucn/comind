/**
 * chip 相关 content 程序化改写后的 renderSegments 本地补算（ADR-0067）。
 *
 * 背景：`updateBlockContent` 在正文变化后清空 renderSegments（旧段偏移已失效），
 * 新段要等防抖 save 返回（Rust save_block_tree 预构建）才写回。窗口期内
 * BulletRender 回退裸文本——视图切换因此闪现 300ms+ 的 `[url](url)` 原文（真机
 * 实测 ~430ms）。chip 改写是**程序化、局部已知**的变换（改别名 / 移除链接 /
 * 拆建块），新段可由旧段精确推导、与 content 变更同拍写入，裸文本窗口归零；
 * save 返回的 Rust 段带 content 守卫覆盖本次结果，段单源仍在 Rust。
 *
 * 所有函数失败一律返回 null（调用方保持现状：段清空 → 回退裸文本），绝不产出
 * 不完整分区——渲染器按段切字，缺口即丢字。
 */

import type { RenderSegment } from '../wasm/types'

/** 校验 segments 恰好构成 [0, total) 的无缝不重叠分区 */
function isExactPartition(segs: RenderSegment[], total: number): boolean {
  let pos = 0
  for (const seg of segs) {
    if (seg.start !== pos || seg.end < seg.start) return false
    pos = seg.end
  }
  return pos === total
}

/**
 * 单 chip 字面改写后的段：`[start, end)` 替换为 `literal`。
 *
 * 前提：chip 字面恰好是一个 `external_link` 段（Rust 严格分区的常态）。替换结果
 * 仍是外链时传 `link`（新段的 display_text = 显示文字），否则落成 text 段
 * （移除链接 = chip 变普通文字，ADR-0067 D5）。
 */
export function patchChipRewrite(
  oldSegs: RenderSegment[],
  start: number,
  end: number,
  literal: string,
  newTotalLength: number,
  link?: { url: string; displayText: string },
): RenderSegment[] | null {
  const replaced = oldSegs.find(
    s => s.start === start && s.end === end && s.type === 'external_link',
  )
  if (!replaced) return null
  const delta = literal.length - (end - start)
  const out: RenderSegment[] = []
  for (const seg of oldSegs) {
    if (seg === replaced) continue
    if (seg.start < end && seg.end > start) return null // 与 chip 局部重叠 → 段不可信
    if (seg.end <= start) out.push(seg)
    else out.push({ ...seg, start: seg.start + delta, end: seg.end + delta })
  }
  const chipSeg: RenderSegment = link
    ? { type: 'external_link', start, end: start + literal.length, url: link.url, display_text: link.displayText }
    : { type: 'text', start, end: start + literal.length }
  out.push(chipSeg)
  out.sort((a, b) => a.start - b.start)
  if (!isExactPartition(out, newTotalLength)) return null
  return out
}

/**
 * chip → 卡片/预览 的拆分段（ADR-0067 D3）：旧段按 chip 边界切成前/后两份，
 * 后份平移到「后文本块」的坐标系。web-link 块自身不渲染 BulletRender，不需要段。
 */
export function splitChipSegments(
  oldSegs: RenderSegment[],
  start: number,
  end: number,
): { before: RenderSegment[]; after: RenderSegment[] } | null {
  const chipSeg = oldSegs.find(
    s => s.start === start && s.end === end && s.type === 'external_link',
  )
  if (!chipSeg) return null
  const before: RenderSegment[] = []
  const after: RenderSegment[] = []
  for (const seg of oldSegs) {
    if (seg === chipSeg) continue
    if (seg.start < end && seg.end > start) return null
    if (seg.end <= start) before.push(seg)
    else after.push({ ...seg, start: seg.start - end, end: seg.end - end })
  }
  const oldTotal = oldSegs.length > 0 ? oldSegs[oldSegs.length - 1].end : 0
  if (!isExactPartition(before, start)) return null
  if (!isExactPartition(after, oldTotal - end)) return null
  return { before, after }
}
