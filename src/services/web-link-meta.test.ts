import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchWebLinkMeta, normalizeWebLinkMetadata } from './web-link-meta'

const invokeMock = vi.fn()
const isTauriMock = vi.fn(() => true)

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}))

describe('normalizeWebLinkMetadata', () => {
  it('snake_case 载荷映射为块内字段，空串不入字段', () => {
    const meta = normalizeWebLinkMetadata({
      final_url: 'https://www.example.com/a',
      domain: 'example.com',
      title: '  标题  ',
      desc: '',
      site_name: null,
      icon_asset_id: 'wl-icon-1',
      cover_asset_id: null,
    })
    expect(meta.title).toBe('标题')
    expect(meta.desc).toBeUndefined()
    expect(meta.siteName).toBeUndefined()
    expect(meta.iconAssetId).toBe('wl-icon-1')
    expect(meta.coverAssetId).toBeUndefined()
    expect(meta.domain).toBe('example.com')
    expect(typeof meta.fetchedAt).toBe('number')
  })

  it('Rust 没给 domain 时从 final_url 推导', () => {
    const meta = normalizeWebLinkMetadata({
      final_url: 'https://www.996m2.com/engine',
      domain: '',
      title: null,
      desc: null,
      site_name: null,
      icon_asset_id: null,
      cover_asset_id: null,
    })
    expect(meta.domain).toBe('996m2.com')
  })
})

describe('fetchWebLinkMeta', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    isTauriMock.mockReturnValue(true)
  })

  it('成功时返回归一后的元数据', async () => {
    invokeMock.mockResolvedValue({
      final_url: 'https://example.com/',
      domain: 'example.com',
      title: 'T',
      desc: 'D',
      site_name: null,
      icon_asset_id: null,
      cover_asset_id: null,
    })
    const result = await fetchWebLinkMeta('https://example.com/')
    expect(invokeMock).toHaveBeenCalledWith('fetch_web_link_metadata', { url: 'https://example.com/' })
    expect(result.meta?.title).toBe('T')
    expect(result.error).toBeUndefined()
  })

  it('Rust 的错误码原样透出，未知错误归一为 network', async () => {
    invokeMock.mockRejectedValueOnce('status')
    expect((await fetchWebLinkMeta('https://example.com/')).error).toBe('status')

    invokeMock.mockRejectedValueOnce(new Error('boom'))
    expect((await fetchWebLinkMeta('https://example.com/')).error).toBe('network')
  })

  it('非 Tauri 环境没有抓取通道（CSP + CORS 双重拦），直接给 network', async () => {
    isTauriMock.mockReturnValue(false)
    const result = await fetchWebLinkMeta('https://example.com/')
    expect(result).toEqual({ meta: null, error: 'network' })
    expect(invokeMock).not.toHaveBeenCalled()
  })
})
