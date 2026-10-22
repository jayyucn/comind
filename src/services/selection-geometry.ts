import type { BlockOffset, RenderedUnitSpan } from './text-range'

/**
 * 文本选区几何映射（DOM 依赖，供 #60 内容区拖拽使用）。
 *
 * 与 `text-range.ts` 的纯计算分离：本模块负责「屏幕坐标 ↔ block 内字符偏移」与
 * 「偏移 ↔ DOM Range」的双向换算，以及跨块选区的高亮矩形计算。
 * 只在运行时（浏览器 / Tauri webview）调用；jsdom 未实现 `Range.getClientRects`，
 * 几何回归由 `selection-geometry.test.ts` 注入替身后覆盖。
 */

/**
 * 文本选区高亮矩形（渲染所需四值）。
 *
 * 不复用 `DOMRect`：矩形经过「行带归一化 + 水平合并」后已不对应任何真实 DOM 盒，
 * 伪装成 DOMRect 只会让人以为能拿去做 `intersects` 之类的几何判断。
 */
export interface SelectionRect {
  left: number
  top: number
  width: number
  height: number
}

/** 取 block 内容区的根元素（文本偏移只统计内容区，不含 bullet/属性区文字） */
function contentRoot(blockEl: HTMLElement): HTMLElement {
  return (blockEl.querySelector('.block-content') as HTMLElement | null) ?? blockEl
}

/**
 * 由屏幕坐标定位 block 内的字符偏移（UTF-16 码元）。
 * 返回 { blockId, offset }；offset 为 block 内容区渲染文本(textContent)中的偏移。
 *
 * 偏移以「渲染文本」为基准是刻意设计（ADR-0035 开放问题 #1，2026-09-13 已决）：
 * 几何模块只负责 DOM 布局 ↔ 渲染文本偏移的映射，不耦合 store、不持有 content/renderSegments。
 * 对含 typed_link/date_ref 等内联标记的块，渲染文本（中文 label）与存储 content（英文 type）
 * 长度不同导致的偏移错位，由消费侧经 `src/services/render-text.ts` 的
 * `renderedOffsetToEncodedOffset` 单一 seam 换算为 encoded 偏移。
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

/**
 * 从当前 DOM selection 读取光标所在的块内偏移（与 `blockOffsetFromPoint` 同口径：
 * 渲染文本 textContent 中的偏移）。
 *
 * 供 shift+click「无选区但有光标」时取起点：光标由激活块内的 ProseMirror 维护，
 * 其 DOM selection 始终反映当前插入位，无需额外维护「上次光标位置」状态。
 * 取 anchor（而非 focus）：PM 对 shift+mousedown 的原生处理会把选区从原光标
 * anchor 延伸到点击处，此时 anchor 仍是原光标位置。光标不在任何块内容区内
 * （聚焦搜索框、页面空白）时返回 null，调用方退化为普通点击。
 */
export function caretBlockOffsetFromDomSelection(): BlockOffset | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !sel.anchorNode) return null
  const node = sel.anchorNode
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement)
  const blockEl = el?.closest('[data-block-id]') as HTMLElement | null
  if (!blockEl) return null
  const blockId = blockEl.getAttribute('data-block-id')
  if (!blockId) return null
  const root = contentRoot(blockEl)
  // bullet 列 / 属性区不作为文本选区起点（与内容区拖拽的命中面一致）
  if (!root.contains(node)) return null
  return { blockId, offset: textNodeOffsetInRoot(root, node, sel.anchorOffset) }
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

/** 取 root 下最后一个**非空**文本节点（offset 越界时用于钳制） */
function lastTextNode(root: HTMLElement): Text | null {
  let last: Text | null = null
  walkTextNodes(root, (node) => { if (node.nodeValue) last = node })
  return last
}

/**
 * 取 root 下第一个**非空**文本节点（无文本时 null）。
 *
 * 必须跳过 `nodeValue === ""` 的文本节点：空块渲染态是 `<span></span>`，Vue 的空插值
 * 会在里面留下一个零长文本节点。只判「节点存在」会把空块误认成有文字的块，
 * 于是走去构造 Range 的路——零长文本节点上的 Range 量不出任何矩形，高亮照旧缺失。
 */
function firstTextNode(root: HTMLElement): Text | null {
  let first: Text | null = null
  walkTextNodes(root, (node) => {
    if (!node.nodeValue) return
    first = node
    return false
  })
  return first
}

/** 按 blockId 取块元素 */
function blockElement(blockId: string): HTMLElement | null {
  return document.querySelector(`[data-block-id="${blockId}"]`)
}

/**
 * 内容区里「整体参与选区」的内联原子单元类名。
 *
 * 与渲染器产出的类名同源（`useContentRenderer.CSS_CLASSES`）：
 * `.block-tag` = inline `#tag` chip、`.date-ref` = `@2026-10-15` 单元、
 * `.block-link` = `[[wiki]]`、`.rel-type-label` = `((关系))` 标签。
 * 与 `createInlineUnitKeyboardPlugin` 的单元口径一致——编辑态由 PM 选区闸门
 * 保证原子性，渲染态（编辑器已卸载）由这里接管。
 */
const ATOMIC_UNIT_SELECTOR = '.block-tag, .date-ref, .block-link, .rel-type-label'

/**
 * 量出某 block 内容区内全部内联原子单元的**渲染文本偏移区间** [start, end)。
 *
 * 为什么不复用 `renderSegments`：文本选区的端点是由 DOM 量出来的渲染偏移
 * （`blockOffsetFromPoint`），单元边界必须来自**同一份 DOM** 才能保证落在同一
 * 坐标系里；且渲染器在无 segments 的块上也会渲染 chip（`#tag` 兜底扫描），
 * 以 DOM 为准才能覆盖该路径。偏移累加复用 `textNodeOffsetInRoot`，与端点同源。
 *
 * 只做度量、不依赖布局：jsdom 亦可断言。
 */
export function atomicUnitSpans(blockId: string): RenderedUnitSpan[] {
  const blockEl = blockElement(blockId)
  if (!blockEl) return []
  const root = contentRoot(blockEl)
  const spans: RenderedUnitSpan[] = []
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(ATOMIC_UNIT_SELECTOR))) {
    const first = firstTextNode(el)
    const last = lastTextNode(el)
    if (!first || !last) continue
    const start = textNodeOffsetInRoot(root, first, 0)
    const end = textNodeOffsetInRoot(root, last, last.length)
    if (end > start) spans.push({ start, end })
  }
  return spans
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
    // 零长文本节点不能作为落点：其上的 Range 量不出矩形（空块渲染态中确实存在这种节点）
    if (len === 0) {
      node = walker.nextNode()
      continue
    }
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

/** 同一 `.block-list` 子树内的全部块元素，文档序 */
function orderedBlockElements(scope: HTMLElement): HTMLElement[] {
  const listRoot = scope.closest('.block-list') ?? document
  return Array.from(listRoot.querySelectorAll<HTMLElement>('[data-block-id]'))
}

/** 原始行盒矩形：只取 `getClientRects()` 的四个基础值（不假定 DOMRect 的 right/bottom 存在） */
interface RawRect {
  left: number
  top: number
  width: number
  height: number
}

const rectRight = (r: RawRect): number => r.left + r.width
const rectBottom = (r: RawRect): number => r.top + r.height

/** 同一视觉行的竖直重叠判据：达到较矮矩形高度的一半即同一行 */
const SAME_LINE_OVERLAP_RATIO = 0.5
/** 水平合并允许的缝隙（px）：padding / inline-flex gap 级别的空隙仍属同一连续选区 */
const MERGE_GAP_PX = 0.75

function verticalOverlapRatio(a: RawRect, b: RawRect): number {
  const overlap = Math.min(rectBottom(a), rectBottom(b)) - Math.max(a.top, b.top)
  const shortest = Math.min(a.height, b.height)
  return shortest > 0 ? overlap / shortest : 0
}

/** 按竖直重叠把矩形分行（同一行内可能有多段：文字 run、chip 外盒、chip 内层 run） */
function groupByLine(rects: RawRect[]): RawRect[][] {
  const lines: RawRect[][] = []
  for (const r of [...rects].sort((a, b) => a.top - b.top)) {
    const line = lines.find((group) => group.some((o) => verticalOverlapRatio(o, r) >= SAME_LINE_OVERLAP_RATIO))
    if (line) line.push(r)
    else lines.push([r])
  }
  return lines
}

/** 块内是否存在 chip（原子单元）之外的文字 —— 决定行带高度能否以本块矩形为准 */
function hasTextOutsideUnits(root: HTMLElement): boolean {
  let found = false
  walkTextNodes(root, (node) => {
    if (!node.nodeValue || !node.nodeValue.trim()) return
    if (node.parentElement?.closest(ATOMIC_UNIT_SELECTOR)) return
    found = true
    return false
  })
  return found
}

/**
 * 把一块内的原始矩形归一成「每行一段」的高亮矩形。
 *
 * 要解决的是 chip 参与选区时的两个错观感（真机取证：纯文本 run 173.5/24，
 * `#任务` 外盒 175.5/21，`#任务` 内层 run 175.5/21，`@2026-10-21` 外盒 175.5/22）：
 *
 * 1. **高度不齐**：`getClientRects()` 返回的是各内联盒自身的矩形，chip（`inline-flex`
 *    的 `.date-ref` / 字号 0.9em 的 `.block-tag`）比文字行盒矮一截、且竖直居中，
 *    于是选区色带在 chip 处凹下去一块。这里把每行所有矩形统一钉到**行带**——
 *    取本行「满高矩形」（文字 run，即行盒）的 top 与 `bandHeight`；整行只有矮矩形
 *    （block 内容本身就是 chip）时以行中心对称扩展，高度取调用方给的行带高度。
 * 2. **chip 内多一层背景**：Chromium 会把 chip 的**外盒**与**内层文本 run** 各报一次
 *    （两者差一个 padding，几何不同，等比去重抓不到），两层 55% 半透明的选区色叠加
 *    ⇒ 该处颜色明显更深（实测亮度 128 vs 98）。这里按行做水平合并，重叠/相切的矩形
 *    连成一段，同一条选区内永不出现叠层。
 * 3. **行缝细线**：文字 run 的矩形比行高多出 1~2px（字体上下溢出），逐行铺满会让
 *    相邻行带在接缝处重叠 —— 又是一处双层半透明。按重叠中点切分，两侧等高、无叠层。
 */
function normalizeLineRects(rects: RawRect[], bandHeight: number): SelectionRect[] {
  const bands = groupByLine(rects)
    .map((line) => {
      const fullHeight = line.filter((r) => r.height >= bandHeight - 0.5)
      // 文字行盒决定行带：它的 top 就是行顶，chip 向内收的部分一并铺满；
      // 整行只有 chip 盒时以行中心对齐行带（chip 竖直居中于行盒）
      const top =
        fullHeight.length > 0
          ? Math.min(...fullHeight.map((r) => r.top))
          : (Math.min(...line.map((r) => r.top)) + Math.max(...line.map((r) => rectBottom(r)))) / 2 -
            bandHeight / 2
      return { top, bottom: top + bandHeight, line }
    })
    .sort((a, b) => a.top - b.top)

  // 相邻行带相切/重叠：文字 run 的矩形高度含字体上下溢出，可比行高多出 1~2px
  // ⇒ 逐行铺满会在行缝处叠一条更深的细线。按重叠**中点**切分，两侧等高、无叠层。
  for (let i = 0; i < bands.length - 1; i++) {
    const overlap = bands[i].bottom - bands[i + 1].top
    if (overlap <= 0) continue
    const cut = bands[i].bottom - overlap / 2
    bands[i].bottom = cut
    bands[i + 1].top = cut
  }

  const out: SelectionRect[] = []
  for (const band of bands) {
    // 水平合并：重叠或相切（≤0.75px 缝隙）的矩形连成一段。chip 的「外盒 + 内层文本 run」
    // 会被 Chromium 同时上报（几何不同，等比去重抓不到），两层半透明色叠出更深的色块。
    const merged: Array<{ left: number; right: number }> = []
    for (const r of [...band.line].sort((a, b) => a.left - b.left)) {
      const cur = merged[merged.length - 1]
      if (cur && r.left <= cur.right + MERGE_GAP_PX) cur.right = Math.max(cur.right, rectRight(r))
      else merged.push({ left: r.left, right: rectRight(r) })
    }
    for (const m of merged) {
      out.push({ left: m.left, top: band.top, width: m.right - m.left, height: band.bottom - band.top })
    }
  }
  return out
}


/** 空白块行首窄条带的宽度（px）：示意「这一行也在选区内」，不铺满整行喧宾夺主 */
const EMPTY_LINE_BAND_WIDTH = 8

/** 块内容区是否有内嵌可见内容（图片 / 代码块 / 媒体）：这类块保留整行色带 */
function hasEmbeddedContent(root: HTMLElement): boolean {
  return root.querySelector('img, .image-block, .cm-editor, video, canvas') !== null
}

/** 文字行带的左缘：内层文本容器的 padding-left 之后（与文字 Range 矩形同位） */
function textBandLeft(root: HTMLElement, boxLeft: number): number {
  const inner = root.firstElementChild as HTMLElement | null
  if (!inner) return boxLeft
  const pad = Number.parseFloat(getComputedStyle(inner).paddingLeft)
  return boxLeft + (Number.isFinite(pad) ? pad : 0)
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
 *    span.wiki-bracket`）时，Chromium 会把同一段内联盒子**重复上报**（既有浮点值逐位
 *    相同的重复，也有 chip 外盒 + 内层文本 run 这种「差一个 padding」的重复）——
 *    覆盖层同位叠两层，半透明色叠出更深的色块。故逐块收集后统一做行带归一化 +
 *    水平合并（见 `normalizeLineRects`）：每行只留一段、一行之内不叠层。
 *
 * 无文本节点的块分两类补色带（2026-10-22 用户样例）：
 * - 空白块（空行）：只在**行首**补一条窄条带，左缘与文字行带对齐（内层文本容器的
 *   padding 之后）——整行铺满会把「本来什么都没有的一行」画得像有内容，观感喧宾夺主。
 * - 图片块等有内嵌可见内容的块：保留整行色带（内容本身占据行宽）。
 * 两类都要求行盒非零：高度为 0 说明该块不可见（折叠子树被 display:none），
 * 此时不补矩形（画出来反而凭空高亮一块看不见的区域）。
 * 这类块也不得牵连整条选区——拖拽时鼠标扫过空行是常态。端点落在这种块上时，
 * 该端点仍由相邻文本块的边界兜底（首侧取块首、尾侧取块末）。
 */
export function selectionClientRects(anchor: BlockOffset, head: BlockOffset): SelectionRect[] {
  const anchorEl = blockElement(anchor.blockId)
  const headEl = blockElement(head.blockId)
  if (!anchorEl || !headEl) return []

  const all = orderedBlockElements(anchorEl)
  const anchorIdx = all.indexOf(anchorEl)
  const headIdx = all.indexOf(headEl)
  if (anchorIdx < 0 || headIdx < 0) return []

  // 端点先后按**块在文档序中的位置**判定，不再用 `Range.compareBoundaryPoints`：
  // 无文本节点的块构造不出 Range，比较不了——旧实现据此 `return []` 丢弃整条选区，
  // 表现为「拖拽扫过空行时高亮整体消失」。同块内退回按字符偏移判序：`Range.setEnd`
  // 遇到早于起点的终点不报错，而是把起点钳到终点，range 塌缩成零宽矩形（向上拖拽
  // 选不出来的根因，ADR-0035）。
  const reversed = anchorIdx > headIdx || (anchorIdx === headIdx && anchor.offset > head.offset)
  const start = reversed ? head : anchor
  const end = reversed ? anchor : head

  const perBlock: Array<{ root: HTMLElement; rects: RawRect[] }> = []
  for (let i = Math.min(anchorIdx, headIdx); i <= Math.max(anchorIdx, headIdx); i++) {
    const el = all[i]
    const blockId = el.getAttribute('data-block-id')
    if (!blockId) continue

    const root = contentRoot(el)
    const first = firstTextNode(root)
    const last = lastTextNode(root)
    if (!first || !last) {
      // 无文本节点的块：操作侧照样整块带走（删除整删、复制留空行），视觉必须跟上。
      // 空白块 = 行首窄条带（左缘对齐文字行带）；图片块等有内嵌内容 = 整行色带。
      // 行盒高度为 0 说明该块不可见（折叠子树被 display:none），此时不补矩形
      // （画出来反而凭空高亮一块看不见的区域）。
      const box = root.getBoundingClientRect()
      if (box.width > 0 && box.height > 0) {
        if (hasEmbeddedContent(root)) {
          perBlock.push({
            root,
            rects: [{ left: box.left, top: box.top, width: box.width, height: box.height }],
          })
        } else {
          perBlock.push({
            root,
            rects: [
              {
                left: textBandLeft(root, box.left),
                top: box.top,
                width: EMPTY_LINE_BAND_WIDTH,
                height: box.height,
              },
            ],
          })
        }
      }
      continue
    }

    // 端点侧用真实拖拽端点，其余侧夹到该块的首/末文本节点。端点块本身无文本节点时
    // 不提供 Range 端点（上面已给它补过行盒色带），改由相邻文本块的边界兜底。
    const from = blockId === start.blockId ? collapsedRangeAtBlockOffset(blockId, start.offset) : null
    const to = blockId === end.blockId ? collapsedRangeAtBlockOffset(blockId, end.offset) : null

    const range = document.createRange()
    range.setStart(from ? from.startContainer : first, from ? from.startOffset : 0)
    range.setEnd(to ? to.startContainer : last, to ? to.startOffset : last.length)

    const rects = Array.from(range.getClientRects())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({ left: r.left, top: r.top, width: r.width, height: r.height }))
    if (rects.length > 0) perBlock.push({ root, rects })
  }

  // 行带高度：同块内各行共用一套行盒（同一字体/行高），取块内最高矩形即可；块内容
  // 全是 chip（无 chip 外文字）时本块矩形全是矮内联盒，借整条选区的行带兜底，
  // 否则纯 chip 块的高亮会比相邻文字行矮一截。
  const globalBand = Math.max(0, ...perBlock.flatMap((b) => b.rects.map((r) => r.height)))

  const out: SelectionRect[] = []
  for (const { root, rects } of perBlock) {
    const blockBand = Math.max(...rects.map((r) => r.height))
    const bandHeight = hasTextOutsideUnits(root) ? blockBand : Math.max(blockBand, globalBand)
    out.push(...normalizeLineRects(rects, bandHeight))
  }
  return out
}
