// epub-sanitize 单测（票 03 / ADR-0040 D10）：EPUB 章节 XHTML 是外部 HTML，
// 注入主文档前必须过严格 allowlist 清洗。恶意 fixture 全部来自真实攻击面：
// script / 事件属性 / javascript: 链接 / 外链 img / style / iframe。
import { describe, it, expect } from 'vitest'
import { sanitizeChapterContent } from './epub-sanitize'

/** 模拟 foliate section.createDocument() 的产物：解析 HTML 取 body 元素 */
function parseBody(html: string): HTMLElement {
  return new DOMParser().parseFromString(html, 'text/html').body
}

/** sanitize 后塞进容器，便于查询断言 */
function renderSanitized(html: string): HTMLElement {
  const container = document.createElement('div')
  container.appendChild(sanitizeChapterContent(parseBody(html)))
  return container
}

describe('sanitizeChapterContent — 恶意内容剥离', () => {
  it('script 标签（含内容）被整体剥离', () => {
    const container = renderSanitized(
      '<p>正文前</p><script>alert("xss")</script><p>正文后</p>',
    )
    expect(container.querySelector('script')).toBeNull()
    expect(container.innerHTML).not.toContain('alert')
    expect(container.textContent).toContain('正文前')
    expect(container.textContent).toContain('正文后')
  })

  it('嵌套在 allowlist 标签内的 script 同样被剥离', () => {
    const container = renderSanitized(
      '<div><p>段落</p><script>evil()</script></div>',
    )
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('p')?.textContent).toBe('段落')
  })

  it('onerror/onclick 等事件属性被剥（含 allowlist 标签上）', () => {
    const container = renderSanitized(
      '<p onclick="evil()">文本</p><img src="blob:u1" onerror="evil()" alt="图"/>',
    )
    expect(container.innerHTML).not.toContain('onclick')
    expect(container.innerHTML).not.toContain('onerror')
    expect(container.querySelector('p')?.textContent).toBe('文本')
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('图')
  })

  it('javascript: 链接被中和：a 保留文本但 href 被剥', () => {
    const container = renderSanitized(
      '<a href="javascript:alert(1)">恶意链接</a><a href="https://evil.com">外链</a>',
    )
    const links = container.querySelectorAll('a')
    expect(links).toHaveLength(2)
    // 链接文本保留（faithful），但 href 一律不保留（书内跳转由阅读器接管，v1 先不开放）
    expect(links[0].getAttribute('href')).toBeNull()
    expect(links[1].getAttribute('href')).toBeNull()
    expect(links[0].textContent).toBe('恶意链接')
  })

  it('外链 img（http/https/data）的 src 被剥，仅允许 blob:（同书资源）', () => {
    const container = renderSanitized(
      '<figure>' +
        '<img src="https://evil.com/x.png" alt="外链图"/>' +
        '<img src="data:image/png;base64,evil" alt="data图"/>' +
        '<img src="blob:book-resource" alt="书内图"/>' +
        '</figure>',
    )
    const imgs = container.querySelectorAll('img')
    expect(imgs).toHaveLength(3)
    expect(imgs[0].getAttribute('src')).toBeNull()
    expect(imgs[1].getAttribute('src')).toBeNull()
    expect(imgs[2].getAttribute('src')).toBe('blob:book-resource')
    // alt 为无害展示属性，保留
    expect(imgs[0].getAttribute('alt')).toBe('外链图')
  })

  it('style 与 iframe 被整体剥离', () => {
    const container = renderSanitized(
      '<style>body { background: red }</style><iframe src="https://evil.com"></iframe><p>正文</p>',
    )
    expect(container.querySelector('style')).toBeNull()
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.innerHTML).not.toContain('background')
    expect(container.querySelector('p')?.textContent).toBe('正文')
  })

  it('注释节点被丢弃', () => {
    const container = renderSanitized('<p>正文</p><!-- 隐蔽注释 -->')
    expect(container.innerHTML).not.toContain('<!--')
    expect(container.querySelector('p')?.textContent).toBe('正文')
  })

  it('未知标签被 unwrap：标签丢弃但正文保留', () => {
    const container = renderSanitized('<epub:switch><p>正文</p></epub:switch>')
    expect(container.querySelector('epub\\:switch')).toBeNull()
    expect(container.querySelector('p')?.textContent).toBe('正文')
  })
})

describe('sanitizeChapterContent — allowlist 内容忠实保留', () => {
  it('结构性标签与文本完整保留', () => {
    const html =
      '<h1>标题</h1><h2>二级</h2>' +
      '<p>段落<em>强调</em><strong>加粗</strong><i>斜体</i><b>粗体</b></p>' +
      '<blockquote>引用</blockquote>' +
      '<ul><li>列表项</li></ul><ol start="3"><li>有序项</li></ol>' +
      '<figure><img src="blob:u" alt="插图"/><figcaption>图注</figcaption></figure>' +
      '<table><thead><tr><th>表头</th></tr></thead><tbody>' +
      '<tr><td colspan="2">单元格</td></tr></tbody></table>' +
      '<span>行内</span><code>代码</code><pre>预格式</pre>' +
      '<hr/><br/><sub>下标</sub><sup>上标</sup>'

    const container = renderSanitized(html)

    for (const tag of [
      'h1', 'h2', 'p', 'em', 'strong', 'i', 'b', 'blockquote',
      'ul', 'ol', 'li', 'figure', 'img', 'figcaption',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'span', 'code', 'pre', 'hr', 'br', 'sub', 'sup',
    ]) {
      expect(container.querySelector(tag), `标签 <${tag}> 应保留`).toBeTruthy()
    }
    expect(container.querySelector('h1')?.textContent).toBe('标题')
    expect(container.querySelector('em')?.textContent).toBe('强调')
    expect(container.querySelector('td')?.getAttribute('colspan')).toBe('2')
    expect(container.querySelector('ol')?.getAttribute('start')).toBe('3')
  })

  it('无害但不在 allowlist 的属性被剥（class/id/style/dir 等）', () => {
    const container = renderSanitized(
      '<p class="calibre1" id="p01" style="margin:0" dir="ltr">文本</p>',
    )
    const p = container.querySelector('p')
    expect(p?.textContent).toBe('文本')
    expect(p?.getAttribute('class')).toBeNull()
    expect(p?.getAttribute('id')).toBeNull()
    expect(p?.getAttribute('style')).toBeNull()
    expect(p?.getAttribute('dir')).toBeNull()
  })

  it('空 body 产出空 fragment（不报错）', () => {
    const container = renderSanitized('')
    expect(container.children).toHaveLength(0)
  })
})
