// CFI 锚定封装（票 04 进度 / 票 05 高亮共用，ADR-0040 D1/D6/D7）：
// foliate epubcfi 的 fromRange/toRange 以「章节 Document 的 documentElement」
// 为寻址根，而本项目正文渲染在主文档的滚动容器里（自渲染非 iframe）。
// 这里用「离屏同构拷贝」桥接：把容器 importNode 深拷贝进一个离屏 Document
// （结构固定为 html > body > 容器），生成时把主文档 Range 边界按 child 索引
// 路径映射进拷贝树，解析时反向映射回主文档。
//
// 不变量：CFI 生成与解析都基于 sanitize 后的同构 DOM（渲染容器 ↔ 其深拷贝，
// importNode 逐节点保序对应），与渲染/排版状态无关——排版变化（字号/行距/
// 行宽）后 CFI 锚点不漂移。完整 CFI 形态：
//   epubcfi(/6/{(spineIndex+1)*2}!/{本地路径}[,start,end])
// 前缀用 foliate 的 fake.fromIndex 造（无真实 package document，系统内自洽，
// v1 不求与外部阅读器 CFI 互译）。
import { fromRange, toRange, parse, joinIndir, fake } from 'foliate-js/epubcfi.js'
import type { CFIStep, CFIParts, CFIRangeParts } from 'foliate-js/epubcfi.js'

/**
 * 容器 → 离屏同构拷贝。拷贝树与渲染树由 importNode 深拷贝产生，
 * childNodes 索引一一对应（sanitize 产物只含 element/text 节点）。
 */
function makeOffscreenCopy(container: Element): { doc: Document; copy: Element } {
  const doc = document.implementation.createHTMLDocument('reader-cfi')
  const copy = doc.importNode(container, true)
  doc.body.appendChild(copy)
  return { doc, copy }
}

/**
 * 同构树节点映射：source 树中的 node → target 树中对应节点。
 * 按 parentNode 链 + childNodes 索引逐层定位（深拷贝保序，索引一致）。
 */
function mapNode(source: Node, target: Node, node: Node): Node | null {
  if (node === source) return target
  const parent = node.parentNode
  if (!parent) return null
  const parentTarget = mapNode(source, target, parent)
  if (!parentTarget) return null
  const index = Array.prototype.indexOf.call(parent.childNodes, node)
  return parentTarget.childNodes[index] ?? null
}

/** 剥离 section 前缀后的本地点/range 结构 + 前缀首组（spine 前缀提取用） */
interface LocalCFI {
  local: CFIParts | CFIRangeParts
  prefixFirst: CFIStep[]
}

/**
 * 把 parse() 结果拆为「前缀组 + 本地结构」。foliate 语义：
 * - 点 CFI：组序列 [前缀组..., 本地组]，本地 = 最后一组
 * - range CFI：parent 为 [前缀组..., 本地共同路径组]，start/end 本就在本地
 */
function splitSectionPrefix(parsed: CFIParts | CFIRangeParts): LocalCFI | null {
  if (Array.isArray(parsed)) {
    if (parsed.length < 2) return null
    return { local: [parsed[parsed.length - 1]], prefixFirst: parsed[0] }
  }
  const { parent, start, end } = parsed
  if (!Array.isArray(parent) || parent.length < 2) return null
  return { local: { parent: [parent[parent.length - 1]], start, end }, prefixFirst: parent[0] }
}

/**
 * 从主文档容器内的选区 Range 生成完整 CFI（含 spine 前缀）。
 * 选区边界必须在 container 子树内（调用方保证），否则抛错（编程错误）。
 */
export function cfiFromRange(container: Element, range: Range, spineIndex: number): string {
  const { doc, copy } = makeOffscreenCopy(container)
  const startNode = mapNode(container, copy, range.startContainer)
  const endNode = mapNode(container, copy, range.endContainer)
  if (!startNode || !endNode) {
    throw new Error('[epub-cfi] 选区边界不在章节容器内')
  }
  const offRange = doc.createRange()
  offRange.setStart(startNode, range.startOffset)
  offRange.setEnd(endNode, range.endOffset)
  const local = fromRange(offRange)
  return joinIndir(fake.fromIndex(spineIndex), local)
}

/**
 * 解析完整 CFI → 主文档容器内的 Range。任何失败（畸形 CFI、书文件变更后
 * 节点不存在、指向容器外等）返回 null，由调用方静默跳过（不阻塞渲染）。
 */
export function cfiToRange(container: Element, cfi: string): Range | null {
  if (!cfi) return null
  let parsed: CFIParts | CFIRangeParts
  try {
    parsed = parse(cfi)
  } catch {
    return null
  }
  const split = splitSectionPrefix(parsed)
  if (!split) return null

  const { doc, copy } = makeOffscreenCopy(container)
  let offRange: Range
  try {
    offRange = toRange(doc, split.local)
  } catch {
    return null
  }
  // 解析结果必须落在容器拷贝子树内（畸形 CFI 可能漂到 body 上）
  if (!isWithinTree(offRange.startContainer, copy) || !isWithinTree(offRange.endContainer, copy)) {
    return null
  }
  const startNode = mapNode(copy, container, offRange.startContainer)
  const endNode = mapNode(copy, container, offRange.endContainer)
  if (!startNode || !endNode) return null
  const range = document.createRange()
  try {
    range.setStart(startNode, offRange.startOffset)
    range.setEnd(endNode, offRange.endOffset)
  } catch {
    return null
  }
  return range
}

/** node 是否在 root 子树内（含 root 自身） */
function isWithinTree(node: Node, root: Node): boolean {
  for (let cur: Node | null = node; cur; cur = cur.parentNode) {
    if (cur === root) return true
  }
  return false
}

/**
 * 从完整 CFI 提取 spine 章节序号（前缀 /6/N 的 N：spine item index = N/2-1）。
 * 前缀不合形态（非本书/畸形）返回 null。用于恢复进度时定位章节。
 */
export function cfiToSpineIndex(cfi: string): number | null {
  if (!cfi) return null
  let parsed: CFIParts | CFIRangeParts
  try {
    parsed = parse(cfi)
  } catch {
    return null
  }
  const groups = Array.isArray(parsed) ? parsed : parsed.parent
  const first = groups?.[0]
  // 前缀首组应为 [{index:6}(package spine 元素), {index:(i+1)*2}(spine item)]
  if (!Array.isArray(first) || first[0]?.index !== 6) return null
  const n = first[1]?.index
  if (typeof n !== 'number' || n < 2 || n % 2 !== 0) return null
  return n / 2 - 1
}
