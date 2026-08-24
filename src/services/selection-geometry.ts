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

/**
 * 由 block 内字符偏移构造一个折叠的 DOM Range（`blockOffsetFromPoint` 的逆映射）。
 * 用于跨块选区高亮时确定起止点。
 */
export function collapsedRangeAtBlockOffset(blockId: string, offset: number): Range | null {
  const blockEl = document.querySelector(`[data-block-id="${blockId}"]`) as HTMLElement | null
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

/**
 * 计算 anchor→head 跨块选区的所有视口矩形（每行一个）。
 * 支持反向拖拽（head 在 anchor 之前自动交换）。
 */
export function selectionClientRects(anchor: BlockOffset, head: BlockOffset): DOMRect[] {
  const a = collapsedRangeAtBlockOffset(anchor.blockId, anchor.offset)
  const h = collapsedRangeAtBlockOffset(head.blockId, head.offset)
  if (!a || !h) return []

  const range = document.createRange()
  range.setStart(a.startContainer, a.startOffset)
  try {
    range.setEnd(h.startContainer, h.startOffset)
  } catch {
    // head 在 anchor 之前（反向拖拽）：交换起止
    range.setEnd(a.startContainer, a.startOffset)
    range.setStart(h.startContainer, h.startOffset)
  }
  return Array.from(range.getClientRects())
}
