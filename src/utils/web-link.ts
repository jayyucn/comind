import type { Block } from '../types/block'
import { toExternalHref } from './mini-markdown'

/**
 * 网页链接块（ADR-0066）的格式单源。
 *
 * 一个块类型 `web-link` + 四种可切换视图，视图与元数据全部落在 `format.link`：
 * - URL 原文在 `content`，四种视图共用同一份正文；
 * - 元数据（标题/摘要/图标/封面）只在抓取成功时写入，全部可由缺省回退；
 * - 视图切换只改 `format.link.view`，不触碰 `content`，因此不进撤销栈。
 */
export const WEB_LINK_TYPE = 'web-link'

export type WebLinkView = 'link' | 'title' | 'card' | 'preview'

/** 面板与菜单里的展示顺序（与飞书一致：由简到繁） */
export const WEB_LINK_VIEWS: WebLinkView[] = ['link', 'title', 'card', 'preview']

export const WEB_LINK_VIEW_LABELS: Record<WebLinkView, string> = {
  link: '链接视图',
  title: '标题视图',
  card: '卡片视图',
  preview: '预览视图',
}

export const WEB_LINK_VIEW_HINTS: Record<WebLinkView, string> = {
  link: '显示网页地址',
  title: '显示网页标题',
  card: '显示标题、摘要与图标',
  preview: '直接嵌入网页',
}

/** 预览视图默认高度与可拖拽范围（px） */
export const DEFAULT_PREVIEW_HEIGHT = 420
export const MIN_PREVIEW_HEIGHT = 160
export const MAX_PREVIEW_HEIGHT = 1600

/** 抓取失败的错误码。失败是常态分支（离线/拒抓/编码不可解），所以进 `meta` 而非抛错 */
export type WebLinkError = 'network' | 'status' | 'timeout' | 'decode'

export const WEB_LINK_ERROR_TEXT: Record<WebLinkError, string> = {
  network: '未能获取网页信息',
  status: '网页拒绝访问',
  timeout: '获取网页信息超时',
  decode: '网页内容无法解析',
}

export interface WebLinkMeta {
  title?: string
  desc?: string
  domain?: string
  siteName?: string
  /** favicon 与封面落地后的 asset id（离线回看不裂图，ADR-0066 D7） */
  iconAssetId?: string
  coverAssetId?: string
  /** 最近一次抓取成功的时间戳（ms） */
  fetchedAt?: number
  /** 最近一次抓取失败的原因；成功时为 undefined */
  error?: WebLinkError
}

export interface WebLinkSettings {
  view: WebLinkView
  previewHeight: number
  meta: WebLinkMeta | null
}

function isWebLinkView(value: unknown): value is WebLinkView {
  return value === 'link' || value === 'title' || value === 'card' || value === 'preview'
}

/** 读侧归一：任何脏值都退回链接视图，绝不因历史脏数据渲染失败 */
export function readWebLink(format: Block['format'] | undefined | null): WebLinkSettings {
  const raw = format?.link as Record<string, unknown> | undefined
  const view = isWebLinkView(raw?.view) ? raw.view : 'link'
  const height = typeof raw?.previewHeight === 'number' ? clampPreviewHeight(raw.previewHeight) : DEFAULT_PREVIEW_HEIGHT
  const meta = raw?.meta && typeof raw.meta === 'object' ? (raw.meta as WebLinkMeta) : null
  return { view, previewHeight: height, meta }
}

/**
 * 生成 `updateBlockFormat` 的入参。
 *
 * `updateBlockFormat` 是浅合并（`{...block.format, ...patch}`），所以嵌套的 `link`
 * 必须在这里整份给全，否则切换视图会把 `meta` 冲掉。
 */
export function patchWebLink(
  format: Block['format'] | undefined | null,
  patch: Partial<WebLinkSettings>,
): Block['format'] {
  const current = readWebLink(format)
  const meta = 'meta' in patch ? patch.meta : current.meta
  const link: Record<string, unknown> = {
    view: patch.view ?? current.view,
    previewHeight: patch.previewHeight ?? current.previewHeight,
  }
  if (meta) link.meta = meta
  return { link }
}

export function clampPreviewHeight(height: number): number {
  if (!Number.isFinite(height)) return DEFAULT_PREVIEW_HEIGHT
  return Math.min(MAX_PREVIEW_HEIGHT, Math.max(MIN_PREVIEW_HEIGHT, Math.round(height)))
}

/**
 * 整段文本恰为一个可识别的 http(s) URL 时返回归一后的地址，否则 null。
 *
 * 判定口径是「整块内容就是一个网址」——含空白、换行、前后缀文字的都不算；
 * 只放行 http(s)，`mailto:` / `javascript:` 一律拒绝（与 `toExternalHref` 同一道闸，
 * 这里额外排掉 mailto，因为邮件地址不是网页）。
 */
export function webLinkUrlOf(text: string | null | undefined): string | null {
  const trimmed = (text ?? '').trim()
  if (!trimmed || /\s/.test(trimmed)) return null
  const href = toExternalHref(trimmed)
  if (!href || !/^https?:\/\//i.test(href)) return null
  try {
    const parsed = new URL(href)
    // 只有主机名没有路径也算合法网页（example.com）；主机名必须含点或为 localhost
    if (!parsed.hostname || (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost')) return null
    return href
  } catch {
    return null
  }
}

/** 域名（去掉 www.，保留端口以外的部分作为展示标签） */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return ''
  }
}

/** 标题回退链：抓到的标题 → 域名 → URL 原文 */
export function webLinkTitle(url: string, meta: WebLinkMeta | null | undefined): string {
  const title = meta?.title?.trim()
  if (title) return title
  const domain = meta?.domain?.trim() || domainOf(url)
  return domain || url
}

/** 摘要：只保留抓取值，抓不到返回空串（由调用方渲染失败文案，不在此处编造） */
export function webLinkSummary(meta: WebLinkMeta | null | undefined): string {
  return meta?.desc?.trim() ?? ''
}

/** 复制/导出的降级形态（ADR-0066 D11）：始终退化为 markdown 链接，卡片不进纯文本面 */
export function webLinkMarkdown(url: string, meta: WebLinkMeta | null | undefined): string {
  const label = webLinkTitle(url, meta)
  return `[${label}](${url})`
}
