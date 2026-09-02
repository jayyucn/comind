// EPUB 章节 XHTML 严格清洗（票 03 / ADR-0040 D10）：
// 章节 XHTML 是外部 HTML，注入主文档（非 iframe）前必须按 allowlist 重建，
// 剥掉 script/style/iframe/事件属性/外链引用等一切可疑内容。
// 实现为「重建」而非「就地删改」：遍历源 DOM、只按白名单在主文档里重新创建节点，
// 属性值由 DOM 序列化转义，天然免疫字符串拼接注入。
//
// 策略：
// - 危险标签（script/style/iframe 等）：连内容整体丢弃
// - allowlist 之外的普通标签：unwrap（丢标签保留子内容，保证正文忠实）
// - 属性：仅标签各自的白名单属性保留；img 的 src 仅允许 blob:（书内资源，
//   由渲染层经 URL.createObjectURL 生成，见 ChapterContent）
// - 文本节点原样保留；注释/处理指令/CDATA 丢弃

/** 允许保留的结构性标签（正文排版所需） */
const ALLOWED_TAGS = new Set([
  // 段落与行内
  'p', 'span', 'br', 'hr', 'wbr',
  'em', 'strong', 'i', 'b', 'u', 's', 'small', 'sub', 'sup',
  'code', 'pre', 'cite', 'q', 'abbr', 'mark',
  'ruby', 'rt', 'rp',
  // 标题
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  // 列表
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  // 引用与图
  'blockquote', 'figure', 'figcaption', 'img',
  // 表格
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
  // 链接（仅保留标签与文本，href 一律不保留：书内跳转由阅读器接管，外链/javascript: 全部中和）
  'a',
  // 容器结构
  'div', 'section', 'article', 'header', 'footer', 'aside', 'main',
])

/** 连内容一起丢弃的危险标签（脚本/样式/交互/嵌入/媒体） */
const DROP_TAGS = new Set([
  'script', 'style', 'link', 'meta', 'base', 'noscript', 'template',
  'iframe', 'object', 'embed', 'applet',
  'form', 'input', 'button', 'select', 'option', 'optgroup', 'textarea',
  'video', 'audio', 'source', 'track', 'canvas',
  'svg', 'math', 'frame', 'frameset',
])

/** 各标签允许保留的属性白名单（img 的 src 另有 blob: 校验） */
const ALLOWED_ATTRS: Record<string, readonly string[]> = {
  img: ['src', 'alt'],
  // 表格跨格是纯结构属性，无风险
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
  // 有序列表起始编号是纯结构属性
  ol: ['start'],
}

/** img src 仅允许 blob:（书内资源经 URL.createObjectURL 生成的同源链接） */
function isAllowedImgSrc(value: string): boolean {
  return value.startsWith('blob:')
}

/** 按白名单拷贝属性（不在白名单或值非法则跳过） */
function copyAllowedAttributes(src: Element, dst: Element): void {
  const allowed = ALLOWED_ATTRS[dst.localName]
  if (!allowed) return
  for (const name of allowed) {
    const value = src.getAttribute(name)
    if (value == null) continue
    if (dst.localName === 'img' && name === 'src' && !isAllowedImgSrc(value)) continue
    dst.setAttribute(name, value)
  }
}

/** 递归重建：把 src 子树按白名单克隆进 target（主文档节点） */
function rebuildNode(src: Node, target: DocumentFragment | Element): void {
  if (src.nodeType === Node.TEXT_NODE) {
    target.appendChild(document.createTextNode(src.textContent ?? ''))
    return
  }
  // 注释 / 处理指令 / CDATA 等一律丢弃
  if (src.nodeType !== Node.ELEMENT_NODE) return

  const el = src as Element
  const tag = el.localName.toLowerCase()

  if (DROP_TAGS.has(tag)) return // 危险标签：连内容丢弃
  if (!ALLOWED_TAGS.has(tag)) {
    // 未知标签：unwrap，保留子内容
    for (const child of Array.from(el.childNodes)) rebuildNode(child, target)
    return
  }

  const clean = document.createElement(tag)
  copyAllowedAttributes(el, clean)
  target.appendChild(clean)
  for (const child of Array.from(el.childNodes)) rebuildNode(child, clean)
}

/**
 * 清洗章节内容：按 allowlist 重建源元素（通常是章节 Document 的 body）的子树，
 * 返回可安全 append 进主文档的 DocumentFragment。
 */
export function sanitizeChapterContent(source: Element): DocumentFragment {
  const fragment = document.createDocumentFragment()
  for (const child of Array.from(source.childNodes)) rebuildNode(child, fragment)
  return fragment
}
