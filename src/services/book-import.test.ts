import { describe, it, expect, vi, beforeEach } from 'vitest'
import { zipSync, strToU8 } from 'fflate'

// ---- 模块 mock：Tauri invoke / 对话框 / fs / 资产存储 / core client ----
const { mockOpen, mockReadFile, mockInvoke, mockAssetSave, mockSavePage, mockDeletePageCascade } =
  vi.hoisted(() => ({
    mockOpen: vi.fn(),
    mockReadFile: vi.fn(),
    mockInvoke: vi.fn(),
    mockAssetSave: vi.fn(),
    mockSavePage: vi.fn(),
    mockDeletePageCascade: vi.fn(),
  }))

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: (...args: unknown[]) => mockOpen(...args) }))
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: (...args: unknown[]) => mockReadFile(...args) }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }))
vi.mock('../utils/asset', () => ({
  assetStorage: { save: (...args: unknown[]) => mockAssetSave(...args) },
}))
vi.mock('../wasm/client', () => ({
  initCoreClient: () =>
    Promise.resolve({ savePage: mockSavePage, deletePageCascade: mockDeletePageCascade }),
  isTauriEnvironment: () => true,
}))

import { importEpub } from './book-import'

// ---- 测试用最小合法 EPUB fixture（mimetype + container.xml + opf + nav + 章节 + 封面） ----

/** 1x1 PNG 前若干字节（只需是"存在且非空"的图片数据，解析层不解码） */
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
])

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`

function makeOpf(withCover: boolean): string {
  const coverItem = withCover
    ? '\n    <item id="cover-image" href="cover.png" media-type="image/png" properties="cover-image"/>'
    : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:00000000-0000-0000-0000-000000000001</dc:identifier>
    <dc:title>测试书名</dc:title>
    <dc:creator>测试作者</dc:creator>
    <dc:language>zh</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>${coverItem}
  </manifest>
  <spine>
    <itemref idref="ch1"/>
  </spine>
</package>`
}

const NAV_XHTML = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>目录</title></head>
  <body>
    <nav epub:type="toc"><ol><li><a href="chapter1.xhtml">第一章</a></li></ol></nav>
  </body>
</html>`

const CHAPTER_XHTML = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>第一章</title></head>
  <body><p>你好，世界。</p></body>
</html>`

/** 用 fflate 构造最小合法 EPUB zip（mimetype 按 OCF 规范 store 不压缩） */
function makeEpubBytes(withCover = true): Uint8Array {
  const files: Record<string, Uint8Array | [Uint8Array, { level: number }]> = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(CONTAINER_XML),
    'OEBPS/content.opf': strToU8(makeOpf(withCover)),
    'OEBPS/nav.xhtml': strToU8(NAV_XHTML),
    'OEBPS/chapter1.xhtml': strToU8(CHAPTER_XHTML),
  }
  if (withCover) files['OEBPS/cover.png'] = PNG_BYTES
  return zipSync(files)
}

function makePage(id: string) {
  return {
    id,
    block_id: null,
    title: '测试书名',
    type: 'book',
    icon: null,
    cover: null,
    aliases: '[]',
    file_path: null,
    children_count: 0,
    word_count: 0,
    deleted: 0,
    created_at: 1,
    updated_at: 1,
  }
}

function setupHappyPath(withCover = true) {
  const bytes = makeEpubBytes(withCover)
  mockOpen.mockResolvedValue('D:/books/测试书名.epub')
  mockReadFile.mockResolvedValue(bytes)
  mockAssetSave.mockImplementation(async (file: File) => ({
    id: 'asset_cover_1',
    name: file.name,
    mimeType: file.type,
    size: file.size,
    blob: file,
    createdAt: 1,
    updatedAt: 1,
  }))
  mockSavePage.mockImplementation(async () => makePage('page_book_1'))
  mockInvoke.mockResolvedValue(undefined)
  return bytes
}

beforeEach(() => {
  mockOpen.mockReset()
  mockReadFile.mockReset()
  mockInvoke.mockReset()
  mockAssetSave.mockReset()
  mockSavePage.mockReset()
  mockDeletePageCascade.mockReset()
})

describe('importEpub', () => {
  it('完整导入：解析元数据 → 封面存 asset → 创建 book Page → 落盘书文件', async () => {
    const bytes = setupHappyPath()

    const page = await importEpub()

    // 书 Page 走现有 page 写路径创建，type='book'，标题取自 OPF，作者进 aliases
    expect(mockSavePage).toHaveBeenCalledWith({
      title: '测试书名',
      type: 'book',
      cover: 'asset://asset_cover_1',
      aliases: '["测试作者"]',
    })
    // 书原文件以 Page id 落 workspace/books/<id>.epub
    expect(mockInvoke).toHaveBeenCalledWith('save_book_file', {
      id: 'page_book_1',
      data: Array.from(bytes),
    })
    expect(page?.id).toBe('page_book_1')
    // 封面以 File 形式存 asset（扩展名取自 MIME）
    expect(mockAssetSave).toHaveBeenCalledTimes(1)
    const savedFile = mockAssetSave.mock.calls[0][0] as File
    expect(savedFile.name).toBe('cover.png')
    expect(savedFile.type).toBe('image/png')
  })

  it('无封面的 EPUB：cover 传 null，不调 assetStorage.save', async () => {
    setupHappyPath(false)

    await importEpub()

    expect(mockAssetSave).not.toHaveBeenCalled()
    expect(mockSavePage).toHaveBeenCalledWith({
      title: '测试书名',
      type: 'book',
      cover: null,
      aliases: '["测试作者"]',
    })
  })

  it('用户取消对话框：返回 null，不发生任何写入', async () => {
    mockOpen.mockResolvedValue(null)

    const page = await importEpub()

    expect(page).toBeNull()
    expect(mockReadFile).not.toHaveBeenCalled()
    expect(mockAssetSave).not.toHaveBeenCalled()
    expect(mockSavePage).not.toHaveBeenCalled()
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('书文件落盘失败：错误向上抛，不回滚已创建的 Page', async () => {
    setupHappyPath()
    mockInvoke.mockRejectedValue(new Error('disk full'))

    await expect(importEpub()).rejects.toThrow('disk full')
    // 不回滚：savePage 复用既有同名 Page 时回滚会误删用户数据（UNIQUE(title) 幂等），故保持不删
    expect(mockDeletePageCascade).not.toHaveBeenCalled()
  })

  it('非法 EPUB：解析错误向上抛', async () => {
    mockOpen.mockResolvedValue('D:/books/broken.epub')
    mockReadFile.mockResolvedValue(strToU8('这不是一个zip文件'))

    await expect(importEpub()).rejects.toThrow()
    expect(mockSavePage).not.toHaveBeenCalled()
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})
