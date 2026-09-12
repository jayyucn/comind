import type { BlockOffset } from './text-range'

/**
 * 文本选区几何映射（DOM 依赖，供 #60 内容区拖拽使用）。
 *
 * 与 `text-range.ts` 的纯计算分离：本模块负责「屏幕坐标 ↔ block 内字符偏移」与
 * 「偏移 ↔ DOM Range」的双向换算，以及跨块选区的高亮矩形计算。
 * 只在运行时（浏览器 / Tauri webview）调用，不参与 vitest。
 */

/** 取 block 内容区的根元素（文本偏移只统计内容区，不含 bullet/属性区文字） */
function contentRoot(blockEl: HTMLElement): HTMLElement {
  return (blockEl.querySelector('.block-content') as HTMLElement | null) ?? blockEl
}

/**
 * 由屏幕坐标定位 block 内的字符偏移（UTF-16 码元）。
 * 返回 { blockId, offset }；offset 为 block 内容区渲染文本(textContent)中的偏移。
 *
 * 已知局限（ADR-0035 开放问题 #1，未解决）：offset 以「渲染文本」为基准，
 * 对纯文本块与存储 content 一致；对含 typed_link/date_ref 等内联标记的块，
 * 渲染文本（中文 label）与存储 content（英文 type）长度不同，偏移会错位。
 * 精确需借 renderSegments 做码点↔码元↔decode 换算（后续独立项）。
 */
export function blockOffsetFromPoint(x: number, y: number): BlockOffset | null {
  const el = document.elementFromPoint(x, y)
  const blockEl = el?.closest('[data-block-id]') as HTMLElement | null
  if (!blockEl) return null

  const blockId = blockEl.getAttribute('data-block-id')
  if (!blockId) return null

  const range = document.caretRangeFromPoint(x, y)
  if (!range) {
    // 无文字命中（如图片块空白区）：视为 block 起始
    return { blockId, offset: 0 }
  }

  return { blockId, offset: textNodeOffsetInRoot(contentRoot(blockEl), range.startContainer, range.startOffset) }
}

/** 遍历 root 下所有文本节点；回调返回 false 提前终止 */
function walkTextNodes(root: Node, fn: (node: Text) => false | void): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    if (fn(node as Text) === false) return
    node = walker.nextNode()
  }
}

/** 累加 root 下各文本节点长度，定位 container 处偏移在 textContent 中的绝对偏移 */
function textNodeOffsetInRoot(root: HTMLElement, container: Node, offset: number): number {
  let total = 0
  walkTextNodes(root, (node) => {
    if (node === container) {
      total += Math.min(offset, node.length)
      return false
    }
    total += node.length
  })
  // container 非文本节点（元素容器）：截至当前累计长度
  return total
}

/** 取 root 下最后一个文本节点（offset 越界时用于钳制） */
function lastTextNode(root: HTMLElement): Text | null {
  let last: Text | null = null
  walkTextNodes(root, (node) => { last = node })
  return last
}

/** 取 root 下第一个文本节点（无文本时 null） */
function firstTextNode(root: HTMLElement): Text | null {
  let first: Text | null = null
  walkTextNodes(root, (node) => { first = node; return false })
  return first
}

/** 按 blockId 取块元素 */
function blockElement(blockId: string): HTMLElement | null {
  return document.querySelector(`[data-block-id="${blockId}"]`)
}

/**
 * 由 block 内字符偏移构造一个折叠的 DOM Range（`blockOffsetFromPoint` 的逆映射）。
 * 用于跨块选区高亮时确定起止点。
 */
export function collapsedRangeAtBlockOffset(blockId: string, offset: number): Range | null {
  const blockEl = blockElement(blockId)
  if (!blockEl) return null

  const root = contentRoot(blockEl)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let remaining = Math.max(0, offset)
  let node = walker.nextNode()
  let target: { node: Text; offset: number } | null = null
  while (node) {
    const len = (node as Text).length
    if (remaining <= len) {
      target = { node: node as Text, offset: remaining }
      break
    }
    remaining -= len
    node = walker.nextNode()
  }

  if (target) {
    const range = document.createRange()
    range.setStart(target.node, target.offset)
    range.setEnd(target.node, target.offset)
    return range
  }

  // offset 超出文本总长：落到最后一个文本节点末尾
  const last = lastTextNode(root)
  if (!last) return null
  const range = document.createRange()
  range.setStart(last, last.length)
  range.setEnd(last, last.length)
  return range
}

/** 同一 `.block-list` 子树内、文档序 startEl→endEl（含两端）的块元素 */
function blocksBetween(startEl: HTMLElement, endEl: HTMLElement): HTMLElement[] {
  const scope = startEl.closest('.block-list') ?? document
  const all = Array.from(scope.querySelectorAll<HTMLElement>('[data-block-id]'))
  const from = all.indexOf(startEl)
  const to = all.indexOf(endEl)
  if (from < 0 || to < 0 || from > to) return []
  return all.slice(from, to + 1)
}

/**
 * 计算 anchor→head 跨块选区的所有视口矩形（每行一个）。
 * 支持反向拖拽（head 在 anchor 之前自动交换）。
 *
 * 逐块构造**只覆盖文字**的子 Range，而不是跨块一个大 Range：
 * 1. 大 Range 在文档序上必然包住各块行首的 bullet / chevron 槽位（它们都排在
 *    `.block-body` 之前），`getClientRects()` 会为这些槽位各吐一个矩形——高亮
 *    凭空盖住 bullet dot。
 * 2. 非端点侧若用容器边界（`root, 0` … `root.childNodes.length`），`getClientRects()`
 *    还会多吐一个「整个内容区盒子」的矩形，把整行铺成色带；夹到首/末**文本节点**
 *    后只剩逐行的文字行盒（interior 行铺满行宽、末行按实际字符宽度收窄）。
 * 3. Range 跨过嵌套内联元素（如 `[[page]]` 渲染成的 `span > span.block-link >
 *    span.wiki-bracket`）时，Chromium 会把同一段内联盒子**重复上报**（实测两组矩形
 *    浮点值逐位相同）——覆盖层同位叠两层，颜色深一档。按几何去重。
 */
export function selectionClientRects(anchor: BlockOffset, head: BlockOffset): DOMRect[] {
  const a = collapsedRangeAtBlockOffset(anchor.blockId, anchor.offset)
  const h = collapsedRangeAtBlockOffset(head.blockId, head.offset)
  if (!a || !h) return []

  // 反向拖拽（head 在 anchor 之前）必须先按文档序排好两端点：Range.setEnd 遇到
  // 早于起点的终点不会报错，而是把起点钳到终点，range 直接塌缩成锚点处零宽矩形
  // ——高亮整体消失（向上拖拽选不出来的根因）。
  const reversed = a.compareBoundaryPoints(Range.START_TO_START, h) > 0
  const startPoint = reversed ? h : a
  const endPoint = reversed ? a : h

  const startEl = blockElement(reversed ? head.blockId : anchor.blockId)
  const endEl = blockElement(reversed ? anchor.blockId : head.blockId)
  if (!startEl || !endEl) return []

  const blocks = blocksBetween(startEl, endEl)
  const rects: DOMRect[] = []
  const seen = new Set<string>()
  for (let i = 0; i < blocks.length; i++) {
    const root = contentRoot(blocks[i])
    const isFirst = i === 0
    const isLast = i === blocks.length - 1
    // 端点侧用真实拖拽端点，其余侧夹到该块的首/末文本节点
    const startNode = isFirst ? startPoint.startContainer : firstTextNode(root)
    const endNode = isLast ? endPoint.startContainer : lastTextNode(root)
    if (!startNode || !endNode) continue

    const range = document.createRange()
    range.setStart(startNode, isFirst ? startPoint.startOffset : 0)
    range.setEnd(endNode, isLast ? endPoint.startOffset : (endNode as Text).length)
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width <= 0 || rect.height <= 0) continue
      const key = `${Math.round(rect.left * 100)}|${Math.round(rect.top * 100)}|${Math.round(rect.width * 100)}|${Math.round(rect.height * 100)}`
      if (seen.has(key)) continue
      seen.add(key)
      rects.push(rect)
    }
  }
  return rects
}
