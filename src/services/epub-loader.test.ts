// epub-loader 共享模块单测（票 03）：loadEpubFromStorage（阅读器入口）
// 覆盖：read_book_file 字节 → EPUB 实例（sections/toc 可用）、文件缺失抛错、空字节抛错。
// fixture 构造与 book-import.test.ts 同构（fflate zipSync 最小合法 EPUB）。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { zipSync, strToU8 } from 'fflate'

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }))

import { loadEpubFromStorage } from './epub-loader'

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`

const OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:00000000-0000-0000-0000-000000000001</dc:identifier>
    <dc:title>阅读器测试书</dc:title>
    <dc:creator>作者</dc:creator>
    <dc:language>zh</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`

const NAV_XHTML = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>目录</title></head>
  <body>
    <nav epub:type="toc"><ol>
      <li><a href="chapter1.xhtml">第一章</a></li>
      <li><a href="chapter2.xhtml">第二章</a></li>
    </ol></nav>
  </body>
</html>`

function chapterXhtml(title: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>${title}</title></head>
  <body>${body}</body>
</html>`
}

function makeEpubBytes(): Uint8Array {
  return zipSync({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(CONTAINER_XML),
    'OEBPS/content.opf': strToU8(OPF),
    'OEBPS/nav.xhtml': strToU8(NAV_XHTML),
    'OEBPS/chapter1.xhtml': strToU8(chapterXhtml('第一章', '<h1>第一章</h1><p>第一章内容</p>')),
    'OEBPS/chapter2.xhtml': strToU8(chapterXhtml('第二章', '<h1>第二章</h1><p>第二章内容</p>')),
  })
}

beforeEach(() => {
  mockInvoke.mockReset()
})

describe('loadEpubFromStorage', () => {
  it('按 bookId 读 workspace/books/<id>.epub 并解析出 sections 与 toc', async () => {
    mockInvoke.mockResolvedValue(Array.from(makeEpubBytes()))

    const book = await loadEpubFromStorage('page_book_1')

    expect(mockInvoke).toHaveBeenCalledWith('read_book_file', { id: 'page_book_1' })
    expect(book.sections).toHaveLength(2)
    expect(book.sections[0].id).toBe('OEBPS/chapter1.xhtml')
    expect(book.metadata.title).toBe('阅读器测试书')
    expect(book.toc?.map(item => item.label)).toEqual(['第一章', '第二章'])
  })

  it('章节可经 createDocument 解析（foliate 从 zip 内文本加载 XHTML）', async () => {
    mockInvoke.mockResolvedValue(Array.from(makeEpubBytes()))

    const book = await loadEpubFromStorage('page_book_1')
    const doc = await book.sections[0].createDocument()
    const body = doc.getElementsByTagName('body')[0]
    expect(body.textContent).toContain('第一章内容')
  })

  it('TOC href 可经 resolveHref 定位 spine 下标', async () => {
    mockInvoke.mockResolvedValue(Array.from(makeEpubBytes()))

    const book = await loadEpubFromStorage('page_book_1')
    const href = book.toc?.[1]?.href ?? ''
    expect(book.resolveHref(href)?.index).toBe(1)
  })

  it('书文件缺失：read_book_file 报错向上抛（阅读器兜底显示错误态）', async () => {
    mockInvoke.mockRejectedValue('Failed to read book file: 系统找不到指定的文件。')

    await expect(loadEpubFromStorage('missing')).rejects.toThrow('Failed to read book file')
  })

  it('空字节（文件不存在但命令未报错的边界）：抛错', async () => {
    mockInvoke.mockResolvedValue([])

    await expect(loadEpubFromStorage('empty')).rejects.toThrow('书文件为空')
  })

  it('损坏 EPUB：解析错误向上抛', async () => {
    mockInvoke.mockResolvedValue(Array.from(strToU8('这不是一个zip文件')))

    await expect(loadEpubFromStorage('broken')).rejects.toThrow()
  })
})
