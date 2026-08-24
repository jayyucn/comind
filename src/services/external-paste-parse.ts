/**
 * 外部粘贴解析器（ADR-0026 D2–D6）
 *
 * 把外部剪贴板内容（text/html 或 text/plain）解析为 BlockClipPayload 森林，
 * 供 BlockList 粘贴控制器在 block 级上下文下拆分为多个 block。
 *
 * 行为契约：
 * - 源优先级：text/html > text/plain（D2）
 * - HTML 用原生 DOMParser 解析；只提取文本，绝不输出 HTML/属性（D3/D10：
 *   script/style 等标签整枝丢弃，事件属性与危险协议无从进入 content）
 * - 元素映射（D4）：p/div/游离文本→bullet；li→bullet（嵌套列表进 children）；
 *   h1–h6→`#`×N+空格 前缀；pre/code→code；blockquote 退化展平；img 忽略
 * - 嵌套（D5）：仅列表嵌套保留，其余容器展平
 * - 纯文本（D6）：按 \n 拆分、trim、跳过空行
 * - properties 恒为 null（外部无 Property 表数据）
 */
import type { BlockClipPayload, BlockClipboardPayload } from '../types/block'

export const COMIND_BLOCK_MIME = 'application/x-comind-block'

function bullet(content: string, children: BlockClipPayload[] = []): BlockClipPayload {
  return { content, type: 'bullet', format: null, properties: null, children }
}

// ── 纯文本路径（D6） ──────────────────────────────────────────────

/** text/plain 按 \n 切分、每行 trim、跳过空行，每行一个 bullet */
function parsePlainText(text: string): BlockClipPayload[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => bullet(line))
}

// ── HTML 路径（D3/D4/D5） ─────────────────────────────────────────

/** 整枝丢弃的标签（内容也不保留） */
const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'HEAD', 'NOSCRIPT', 'TEMPLATE',
  'IFRAME', 'OBJECT', 'SVG',
])

const LIST_TAGS = new Set(['UL', 'OL'])

/** 块级容器选择器：命中则展平其子节点（D5：非列表嵌套不保留层级） */
const BLOCK_LEVEL_SELECTOR = [
  'p', 'div', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside',
  'ul', 'ol', 'table', 'tr', 'blockquote', 'figure', 'dl', 'form',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre',
].join(',')

function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function parseHtmlBlocks(html: string): BlockClipPayload[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return mapChildren(doc.body)
}

function mapChildren(parent: Node): BlockClipPayload[] {
  const out: BlockClipPayload[] = []
  parent.childNodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = collapseWs(node.textContent ?? '')
      if (text) out.push(bullet(text))
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      out.push(...mapElement(node as Element))
    }
  })
  return out
}

function mapElement(el: Element): BlockClipPayload[] {
  const tag = el.tagName
  if (SKIP_TAGS.has(tag)) return []
  if (tag === 'IMG') return []  // v1 忽略外部图片（D4）
  if (tag === 'BR') return []

  // 列表：li → bullet，嵌套列表进 children（D5）
  if (LIST_TAGS.has(tag)) return mapList(el)

  // 标题：`#`×N + 空格 前缀（与 HeadingPreviewExtension 正则对齐）
  const heading = /^H([1-6])$/.exec(tag)
  if (heading) {
    const text = collapseWs(el.textContent ?? '')
    return text ? [bullet('#'.repeat(Number(heading[1])) + ' ' + text)] : []
  }

  // 代码块：保留内部换行
  if (tag === 'PRE' || tag === 'CODE') {
    const text = (el.textContent ?? '').replace(/\n+$/, '')
    return text.trim()
      ? [{ content: text, type: 'code', format: null, properties: null, children: [] }]
      : []
  }

  // 容器（p/div/blockquote/未知标签等）：
  // 含块级后代 → 展平为同级 sibling；纯行内内容 → 一个 bullet（<br> 视为换行拆行）
  if (el.querySelector(BLOCK_LEVEL_SELECTOR)) {
    return mapChildren(el)
  }
  return inlineBullets(el)
}

/** 行内内容收集：文本节点折叠空白（源码换行视为空格），仅 <br> 产生换行 */
function inlineText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? '').replace(/\s+/g, ' ')
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element
    if (el.tagName === 'BR') return '\n'
    if (SKIP_TAGS.has(el.tagName) || el.tagName === 'IMG') return ''
    let s = ''
    el.childNodes.forEach(child => { s += inlineText(child) })
    return s
  }
  return ''
}

function inlineBullets(el: Element): BlockClipPayload[] {
  return inlineText(el)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => bullet(line))
}

/** <ul>/<ol> → bullet 森林；li 的嵌套列表进入 children */
function mapList(list: Element): BlockClipPayload[] {
  const out: BlockClipPayload[] = []
  for (const child of Array.from(list.children)) {
    if (child.tagName === 'LI') {
      out.push(...mapListItem(child))
    } else if (LIST_TAGS.has(child.tagName)) {
      // 异常嵌套（列表直接套列表）→ 递归展平
      out.push(...mapList(child))
    }
  }
  return out
}

function mapListItem(li: Element): BlockClipPayload[] {
  const textParts: string[] = []
  const childPayloads: BlockClipPayload[] = []

  li.childNodes.forEach(node => {
    if (node.nodeType === Node.ELEMENT_NODE && LIST_TAGS.has((node as Element).tagName)) {
      childPayloads.push(...mapList(node as Element))
    } else {
      textParts.push(inlineText(node))
    }
  })

  const content = collapseWs(textParts.join(''))
  if (content) {
    return [bullet(content, childPayloads)]
  }
  // 空 li 带子列表：子列表提升为同级
  return childPayloads
}

// ── 粘贴分发决策（ADR-0025 D13 + ADR-0026 D8 的纯函数部分） ──────

/**
 * 解析剪贴板数据为待粘贴森林：
 * 1. 命中内部 MIME（application/x-comind-block）→ 返回内部载荷 blocks；
 * 2. 否则按外部规则（html 优先）解析；
 * 3. 无可解析内容 → null。
 */
export function resolveClipboardForest(
  getData: (mime: string) => string
): BlockClipPayload[] | null {
  const internalJson = getData(COMIND_BLOCK_MIME)
  if (internalJson) {
    try {
      const payload = JSON.parse(internalJson) as BlockClipboardPayload
      if (payload && payload.kind === 'blocks' && Array.isArray(payload.blocks)) {
        return payload.blocks
      }
    } catch {
      // 损坏的内部载荷 → 回落外部解析
    }
  }
  const forest = parseExternalPaste({
    html: getData('text/html'),
    plain: getData('text/plain'),
  })
  return forest.length > 0 ? forest : null
}

/** 入口：外部剪贴板 → block 载荷森林（html 优先于 plain，D2） */
export function parseExternalPaste(input: {
  html?: string | null
  plain?: string | null
}): BlockClipPayload[] {
  if (input.html && input.html.trim()) return parseHtmlBlocks(input.html)
  if (input.plain) return parsePlainText(input.plain)
  return []
}
