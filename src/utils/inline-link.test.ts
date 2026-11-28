import { describe, expect, it } from 'vitest'

import { buildInlineLinkLiteral, extractHttpUrl, linkTitleRejectionHint } from './inline-link'

/**
 * 外链写入口的准入判据。
 *
 * 两条判据都是**正则硬边界**的投影（Rust RE_MD_LINK 的 `([^\[\]]+)` 与 `(https?://[^\s)]+)`），
 * 所以每条用例都对应一种「写进去必然断链」的输入，而不是口味偏好。
 */
describe('linkTitleRejectionHint', () => {
  it('普通文字可用', () => {
    expect(linkTitleRejectionHint('飞书文档')).toBeNull()
  })

  it('管道符合法 —— 与页名判据的区别就在这里', () => {
    expect(linkTitleRejectionHint('A|B')).toBeNull()
  })

  it('含方括号：拒绝并点名具体字符', () => {
    expect(linkTitleRejectionHint('a[b')).toContain('「[」')
    expect(linkTitleRejectionHint('a]b')).toContain('「]」')
    expect(linkTitleRejectionHint('a[b]c')).toContain('「[」「]」')
  })

  it('只有空白：拒绝', () => {
    expect(linkTitleRejectionHint('   ')).toContain('空白')
  })

  it('含硬换行：拒绝（段会劈开行盒，chip 变两行）', () => {
    expect(linkTitleRejectionHint('a\nb')).toContain('换行')
    expect(linkTitleRejectionHint('a[b\nc')).toContain('「[」')
    expect(linkTitleRejectionHint('a[b\nc')).toContain('换行')
  })
})

describe('extractHttpUrl', () => {
  it('已带协议：取首个片段，前后文字丢弃', () => {
    expect(extractHttpUrl('看这个 https://a.com/x?q=1 挺好')).toBe('https://a.com/x?q=1')
  })

  it('中文标点是边界，不会吃进 URL', () => {
    expect(extractHttpUrl('https://a.com，然后我们再改')).toBe('https://a.com')
  })

  it('裸域名补 https://', () => {
    expect(extractHttpUrl('feishu.cn/docx/abc')).toBe('https://feishu.cn/docx/abc')
  })

  it('非 http(s) 一律不认（写进去也是死链）', () => {
    expect(extractHttpUrl('javascript:alert(1)')).toBeNull()
    expect(extractHttpUrl('mailto:a@b.com')).toBeNull()
    expect(extractHttpUrl('随便一段话')).toBeNull()
    expect(extractHttpUrl('')).toBeNull()
  })
})

describe('buildInlineLinkLiteral', () => {
  it('标题 trim，字面形态与渲染正则一致', () => {
    expect(buildInlineLinkLiteral('  项目A ', 'https://a.com')).toBe('[项目A](https://a.com)')
  })
})
