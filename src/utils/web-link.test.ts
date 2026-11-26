import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PREVIEW_HEIGHT,
  MAX_PREVIEW_HEIGHT,
  MIN_PREVIEW_HEIGHT,
  clampPreviewHeight,
  domainOf,
  patchWebLink,
  previewSandboxFor,
  readWebLink,
  webLinkMarkdown,
  webLinkTitle,
  webLinkUrlOf,
} from './web-link'

describe('previewSandboxFor', () => {
  it('跨源页面补 allow-same-origin：否则读存储抛 SecurityError，SPA 白屏', () => {
    expect(previewSandboxFor('https://www.doubao.com', 'http://localhost:5173'))
      .toBe('allow-scripts allow-popups allow-forms allow-same-origin')
  })

  it('同源页面不加：allow-scripts + allow-same-origin 能让页面摸到父文档', () => {
    expect(previewSandboxFor('http://localhost:5173/page/x', 'http://localhost:5173'))
      .toBe('allow-scripts allow-popups allow-forms')
  })

  it('解析不出 origin 时按同源处理，保持严格 sandbox', () => {
    expect(previewSandboxFor('not a url', 'http://localhost:5173'))
      .toBe('allow-scripts allow-popups allow-forms')
  })
})

describe('webLinkUrlOf', () => {
  it('整段就是一个 http(s) 网址时归一返回', () => {
    expect(webLinkUrlOf('https://www.996m2.com/engine')).toBe('https://www.996m2.com/engine')
    expect(webLinkUrlOf('  http://example.com/a?b=1  ')).toBe('http://example.com/a?b=1')
  })

  it('无 scheme 的裸域名补 https://', () => {
    expect(webLinkUrlOf('example.com/a')).toBe('https://example.com/a')
  })

  it('含空白或换行的不算「整段是一个网址」', () => {
    expect(webLinkUrlOf('看这个 https://example.com')).toBeNull()
    expect(webLinkUrlOf('https://example.com\nhttps://example.org')).toBeNull()
    expect(webLinkUrlOf('')).toBeNull()
  })

  it('拒绝非 http(s) 方案与非法主机', () => {
    expect(webLinkUrlOf('javascript:alert(1)')).toBeNull()
    expect(webLinkUrlOf('mailto:a@example.com')).toBeNull()
    expect(webLinkUrlOf('file:///etc/passwd')).toBeNull()
    expect(webLinkUrlOf('http://localhost:5173')).toBe('http://localhost:5173')
    expect(webLinkUrlOf('http://foo')).toBeNull()
  })
})

describe('readWebLink', () => {
  it('缺省为链接视图与默认预览高度', () => {
    expect(readWebLink({})).toEqual({
      view: 'link',
      previewHeight: DEFAULT_PREVIEW_HEIGHT,
      meta: null,
    })
    expect(readWebLink(null).view).toBe('link')
  })

  it('脏视图值退回链接视图，脏高度被夹到范围内', () => {
    const settings = readWebLink({ link: { view: 'huge', previewHeight: 99999 } })
    expect(settings.view).toBe('link')
    expect(settings.previewHeight).toBe(MAX_PREVIEW_HEIGHT)
  })

  it('读出已存的元数据', () => {
    const settings = readWebLink({ link: { view: 'card', meta: { title: '标题' } } })
    expect(settings.view).toBe('card')
    expect(settings.meta?.title).toBe('标题')
  })
})

describe('patchWebLink', () => {
  it('切换视图不清掉已有元数据（浅合并陷阱）', () => {
    const format = { link: { view: 'link', previewHeight: 300, meta: { title: 'T' } } }
    const patch = patchWebLink(format, { view: 'card' })
    expect(patch.link).toEqual({ view: 'card', previewHeight: 300, meta: { title: 'T' } })
  })

  it('元数据显式置 null 时整份移除', () => {
    const format = { link: { view: 'card', meta: { title: 'T' } } }
    const patch = patchWebLink(format, { meta: null }) as { link: Record<string, unknown> }
    expect('meta' in patch.link).toBe(false)
  })

  it('保留其它 format 键不动', () => {
    const patch = patchWebLink({ callout: 'warn' }, { view: 'title' })
    expect(patch).not.toHaveProperty('callout')
  })
})

describe('展示回退链', () => {
  it('domainOf 去掉 www 前缀', () => {
    expect(domainOf('https://www.example.com/a')).toBe('example.com')
    expect(domainOf('not a url')).toBe('')
  })

  it('标题优先抓取值，其次域名', () => {
    const url = 'https://www.example.com/a'
    expect(webLinkTitle(url, { title: '真标题' })).toBe('真标题')
    expect(webLinkTitle(url, { error: 'network' })).toBe('example.com')
    expect(webLinkTitle(url, null)).toBe('example.com')
  })

  it('markdown 降级始终产出链接文本', () => {
    expect(webLinkMarkdown('https://example.com/x', { title: '标题' })).toBe('[标题](https://example.com/x)')
    expect(webLinkMarkdown('https://example.com/x', null)).toBe('[example.com](https://example.com/x)')
  })
})

describe('clampPreviewHeight', () => {
  it('夹在可拖拽范围内并取整', () => {
    expect(clampPreviewHeight(0)).toBe(MIN_PREVIEW_HEIGHT)
    expect(clampPreviewHeight(420.6)).toBe(421)
    expect(clampPreviewHeight(Number.NaN)).toBe(DEFAULT_PREVIEW_HEIGHT)
  })
})
