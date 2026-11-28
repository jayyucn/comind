import { invoke, isTauri } from '@tauri-apps/api/core'

import type { WebLinkError, WebLinkMeta } from '../utils/web-link'
import { domainOf } from '../utils/web-link'

/**
 * 网页链接块的元数据抓取（ADR-0066 D3）。
 *
 * 通道只有一条：Tauri 侧 `fetch_web_link_metadata`。前端的 `fetch` 被 CSP
 * `connect-src` 回落与 CORS 双重拦死，浏览器/dev 环境下没有可用通道，
 * 因此返回 `network` 错误码由调用方渲染兜底卡片 —— 这不是异常，是预期分支。
 */
export interface WebLinkFetchResult {
  meta: WebLinkMeta | null
  error?: WebLinkError
}

export interface RawWebLinkMetadata {
  final_url: string
  domain: string
  title: string | null
  desc: string | null
  site_name: string | null
  icon_asset_id: string | null
  cover_asset_id: string | null
}

const ERROR_CODES: WebLinkError[] = ['network', 'status', 'timeout', 'decode']

export async function fetchWebLinkMeta(url: string): Promise<WebLinkFetchResult> {
  if (!isTauri()) return { meta: null, error: 'network' }
  try {
    const raw = await invoke<RawWebLinkMetadata>('fetch_web_link_metadata', { url })
    return { meta: normalizeWebLinkMetadata(raw) }
  } catch (err) {
    return { meta: null, error: errorCodeOf(err) }
  }
}

function errorCodeOf(err: unknown): WebLinkError {
  return typeof err === 'string' && (ERROR_CODES as string[]).includes(err)
    ? (err as WebLinkError)
    : 'network'
}

/** Rust 的 snake_case 载荷 → 块内 `format.link.meta`（空串/空值一律不入字段） */
export function normalizeWebLinkMetadata(raw: RawWebLinkMetadata): WebLinkMeta {
  const meta: WebLinkMeta = { fetchedAt: Date.now() }
  const title = raw.title?.trim()
  if (title) meta.title = title
  const desc = raw.desc?.trim()
  if (desc) meta.desc = desc
  const siteName = raw.site_name?.trim()
  if (siteName) meta.siteName = siteName
  const domain = raw.domain?.trim() || domainOf(raw.final_url)
  if (domain) meta.domain = domain
  if (raw.icon_asset_id) meta.iconAssetId = raw.icon_asset_id
  if (raw.cover_asset_id) meta.coverAssetId = raw.cover_asset_id
  return meta
}
