/**
 * 粘贴即建页（ADR-0043）：对剪贴板可读文本提取 [[wiki 链接]] 目标，
 * 为不存在的目标幂等 Ensure 建页（与键入路径同源：trim、type=normal）。
 *
 * 语义统一：[[x]] 在粘贴路径从「引用已存在页面」变为「声明页面」——
 * ensure 完成后，随后块保存时 Rust 抽链命中、Link 表/图谱边自动成立，
 * 无需手工写 Link 边。触发点为 BlockList.handleDocPaste（一处覆盖三形态：
 * 内部块复制粘贴 / 外部文本-HTML / inline 光标粘贴）。
 */
import { usePageStore } from '../stores/pages'
import { parseExternalPaste } from './external-paste-parse'
import type { BlockClipPayload } from '../types/block'

export interface PasteClipboard {
  /** 剪贴板 text/plain */
  plain?: string | null
  /** 剪贴板 text/html */
  html?: string | null
}

export interface WikiTargetsEnsureResult {
  /** 本次新建的页面标题（文本出现顺序、去重），供调用层 toast 汇总 */
  created: string[]
}

// 与 Rust content_parse_service::extract_links_from_content 的 internal 链接规则对齐：
// [[a|b]] → 目标 a（显示文本 b）；target 与 alias 均 trim；外部目标（http/ftp/mailto）跳过
// （判定与 Rust `target.starts_with(...)` 同构：无冒号要求、大小写敏感）。
// `[[]]` / 纯空白目标因 `[^\]|]` 至少一字符 + trim 后为空而天然不产生目标。
const EXTERNAL_TARGET_PREFIXES = ['http', 'ftp', 'mailto']

/** 与 Rust 抽链同构的外部目标判定（差异会导致「建了页却链不上」） */
function isExternalTarget(target: string): boolean {
  return EXTERNAL_TARGET_PREFIXES.some(p => target.startsWith(p))
}

/** 从一段纯文本中提取 wiki 目标标题（trim + 外部/空白过滤，保持出现顺序、去重） */
function extractTargetsFromText(text: string): string[] {
  const seen = new Set<string>()
  const targets: string[] = []
  // 每次调用新建正则（带 g），避免模块级正则的 lastIndex 跨调用残留
  const re = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g
  for (const m of text.matchAll(re)) {
    const raw = m[1]
    if (!raw) continue
    const target = raw.trim()
    if (!target) continue
    if (isExternalTarget(target)) continue
    if (!seen.has(target)) {
      seen.add(target)
      targets.push(target)
    }
  }
  return targets
}

/** 递归收集外部粘贴森林的全部 content（含嵌套 children，与落库内容同源） */
function collectForestContents(nodes: BlockClipPayload[], out: string[]): string[] {
  for (const n of nodes) {
    out.push(n.content)
    collectForestContents(n.children, out)
  }
  return out
}

/**
 * 剪贴板可读文本 → wiki 目标标题（去重、有序）。
 * 源优先级与落库一致（ADR-0026 D2：html > plain，同 resolveClipboardForest）：
 * html 提炼出内容则只取 html（永不落库的 plain 不产生目标）；提炼为空/失败才降级扫 plain。
 */
function collectTargets(clipboard: PasteClipboard): string[] {
  const seen = new Set<string>()
  const targets: string[] = []
  const add = (text: string) => {
    for (const t of extractTargetsFromText(text)) {
      if (!seen.has(t)) {
        seen.add(t)
        targets.push(t)
      }
    }
  }

  const html = clipboard.html?.trim()
  if (html) {
    try {
      // html 走与外部粘贴落库同源的文本提炼（external-paste-parse 的 SKIP/空白折叠），
      // 避免把标签/属性文本误当目标，也与随后保存的 block content 严格同源。
      const contents = collectForestContents(parseExternalPaste({ html }), [])
      if (contents.length > 0) {
        for (const c of contents) add(c)
        return targets
      }
    } catch {
      // 提炼异常（DOMParser 等）→ 降级扫 plain（若存在），不吞掉 plain 目标
    }
  }
  if (clipboard.plain) add(clipboard.plain)
  return targets
}

/**
 * Ensure 剪贴板文本中所有 [[目标]] 页面存在（幂等）。
 * 依赖页面层 get-or-create（与键入路径同源）；单目标失败跳过、整体失败静默，
 * 绝不阻断粘贴主路径。调用方可安全 fire-and-forget。
 */
export async function ensureWikiLinkTargets(
  clipboard: PasteClipboard
): Promise<WikiTargetsEnsureResult> {
  let targets: string[]
  try {
    targets = collectTargets(clipboard)
  } catch {
    // html 提炼异常（DOMParser 等）→ 视为无可建目标
    return { created: [] }
  }
  if (targets.length === 0) return { created: [] }

  const pageStore = usePageStore()
  const created: string[] = []
  for (const title of targets) {
    try {
      // 存在性预检 + get-or-create（幂等）：预检同时用于区分「本次新建」供 toast
      if (pageStore.getPageByTitle(title)) continue
      await pageStore.getOrCreatePageByTitle(title)
      created.push(title)
    } catch {
      // 单目标失败不阻断其余目标；新建页残留与键入路径同语义、不做回收
    }
  }
  return { created }
}

/**
 * 本次新建 N>0 时经 toast 通道汇总一次（如「已创建 2 个页面：产品评审、复盘模板」）。
 * N=0 完全静默。
 */
export function notifyCreatedPages(
  created: string[],
  showToast: (message: string, type?: 'info' | 'warning' | 'error') => void
): void {
  if (created.length === 0) return
  showToast(`已创建 ${created.length} 个页面：${created.join('、')}`, 'info')
}
