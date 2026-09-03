// 票 06 组件接线测试：ReaderView/ChapterContent/NoteInputPopover。
// 覆盖：选区写笔记全流程（高亮行先落库→输入浮层→Block service 接管）、
// 已有高亮写笔记（含 block_id 预填旧文更新同一条）、jump-to 跨窗口事件
// （切章+scrollIntoView+闪烁）、新建窗口 URL query 跳回原文。
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import type { EPUB, EPUBSection } from 'foliate-js/epub.js'
import { cfiFromRange } from '../../services/epub-cfi'
import { useReaderTypography } from '../../composables/useReaderTypography'
import type { BookHighlightRust, BookProgressRust } from '../../wasm/types'

const {
  mockLoadBook, mockGetBookProgress, mockGetBookHighlights, mockUpsertBookHighlight,
  mockDeleteBookHighlight, mockCreateOrUpdateNoteBlock, mockLoadNoteText, mockListen,
} = vi.hoisted(() => ({
  mockLoadBook: vi.fn(),
  mockGetBookProgress: vi.fn(),
  mockGetBookHighlights: vi.fn(),
  mockUpsertBookHighlight: vi.fn(),
  mockDeleteBookHighlight: vi.fn(),
  mockCreateOrUpdateNoteBlock: vi.fn(),
  mockLoadNoteText: vi.fn(),
  mockListen: vi.fn(),
}))

/** 绘制层断言用的 Fake Highlight（jsdom 无 CSS Custom Highlight API） */
class FakeHighlight {
  ranges: Range[]
  constructor(...ranges: Range[]) {
    this.ranges = ranges
  }
}

/** CSS.highlights 注册表（stub），供绘制断言 */
function highlightRegistry(): Map<string, FakeHighlight> {
  return (CSS as unknown as { highlights: Map<string, FakeHighlight> }).highlights
}

// 阅读器窗口为非 Tauri 环境（窗口控制早退）；jump-to 监听走 event mock
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }))
vi.mock('@tauri-apps/api/event', () => ({ listen: mockListen }))
vi.mock('../../services/epub-loader', () => ({
  loadEpubFromStorage: (...args: unknown[]) => mockLoadBook(...args),
  formatLanguageMap: (x: unknown) => {
    if (typeof x === 'string') return x
    if (x && typeof x === 'object') {
      return String(Object.values(x as Record<string, unknown>)[0] ?? '')
    }
    return ''
  },
}))
vi.mock('../../wasm/client', () => ({
  initCoreClient: async () => ({
    getBookProgress: mockGetBookProgress,
    upsertBookProgress: vi.fn(),
    getBookHighlights: mockGetBookHighlights,
    upsertBookHighlight: mockUpsertBookHighlight,
    deleteBookHighlight: mockDeleteBookHighlight,
  }),
  isTauriEnvironment: () => false,
}))
// 票 06 业务（生成/更新 Block）已由 book-note.test.ts 覆盖，此处 mock 验证接线
vi.mock('../../services/book-note', () => ({
  createOrUpdateNoteBlock: mockCreateOrUpdateNoteBlock,
  loadNoteText: mockLoadNoteText,
}))

import ReaderView from './ReaderView.vue'

/** 章节 mock：createDocument 返回 DOMParser 解析的 Document */
function makeSection(id: string, bodyHtml: string): EPUBSection {
  return {
    id,
    createDocument: async () =>
      new DOMParser().parseFromString(`<html><body>${bodyHtml}</body></html>`, 'text/html'),
  }
}

/** EPUB 实例 mock：三章节 + 平铺 TOC */
function makeBook(): EPUB {
  const sections: EPUBSection[] = [
    makeSection('ch1.xhtml', '<h1>第一章</h1><p>第一章内容</p>'),
    makeSection('ch2.xhtml', '<h1>第二章</h1><p>第二章内容</p>'),
    makeSection('ch3.xhtml', '<h1>第三章</h1><p>第三章内容</p>'),
  ]
  const book = {
    metadata: { title: '测试书' },
    sections,
    toc: [
      { label: '第一章', href: 'ch1.xhtml', subitems: null },
      { label: '第二章', href: 'ch2.xhtml', subitems: null },
      { label: '第三章', href: 'ch3.xhtml', subitems: null },
    ],
    loadBlob: vi.fn(async (uri: string) => new Blob(['img:' + uri])),
    resolveHref: (href: string) => {
      const path = href.split('#')[0]
      const index = sections.findIndex(s => s.id === path)
      return index >= 0 ? { index, anchor: () => null } : null
    },
    getCover: async () => null,
  }
  return book as unknown as EPUB
}

/** 高亮记录构造 */
function makeHighlight(id: string, cfi: string, text: string, blockId: string | null = null): BookHighlightRust {
  return {
    id,
    book_page_id: 'book-1',
    cfi,
    text,
    chapter: '第一章',
    color: 'yellow',
    block_id: blockId,
    created_at: 1,
    updated_at: 1,
  }
}

/** 在正文容器内选中文本并派发 selectionchange */
function selectText(wrapper: ReturnType<typeof mountReader>, selector: string, start: number, end: number): void {
  const contentEl = wrapper.get('.chapter-content').element as HTMLElement
  const text = contentEl.querySelector(selector)!.firstChild!
  const sel = document.getSelection()!
  sel.removeAllRanges()
  const range = document.createRange()
  range.setStart(text, start)
  range.setEnd(text, end)
  sel.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
}

/** 触发已注册的跨窗口事件回调 */
function fireListenEvent(event: string, payload: unknown): void {
  const calls = mockListen.mock.calls as unknown as Array<[string, (e: { payload: unknown }) => void]>
  const hit = calls.find(c => c[0] === event)
  expect(hit, `事件 ${event} 未注册监听`).toBeTruthy()
  hit![1]({ payload })
}

function mountReader(bookId = 'book-1') {
  // pinia：票 07 高亮面板 setup 即取 blocks store（join 笔记摘要）
  return mount(ReaderView, {
    props: { bookId },
    attachTo: document.body,
    global: { plugins: [createPinia()] },
  })
}

/** 输入浮层 textarea 填值并派发 input（v-model） */
function fillNoteText(value: string): void {
  const textarea = document.body.querySelector('.note-input-popover textarea') as HTMLTextAreaElement
  expect(textarea, '输入浮层未出现').toBeTruthy()
  textarea.value = value
  textarea.dispatchEvent(new Event('input'))
}

/** 提交输入浮层 */
function submitNote(): void {
  const btn = document.body.querySelector('.note-input-popover button.primary') as HTMLButtonElement
  expect(btn, '保存按钮未找到').toBeTruthy()
  btn.click()
}

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:mock-object-url')
  URL.revokeObjectURL = vi.fn()
  ;(globalThis as { Highlight?: unknown }).Highlight = FakeHighlight
  ;(globalThis as { CSS?: unknown }).CSS = { highlights: new Map() }
})

afterAll(() => {
  delete (globalThis as { Highlight?: unknown }).Highlight
  delete (globalThis as { CSS?: unknown }).CSS
})

beforeEach(() => {
  vi.clearAllMocks()
  mockLoadBook.mockReset()
  mockGetBookProgress.mockReset()
  mockGetBookProgress.mockResolvedValue(null)
  mockGetBookHighlights.mockReset()
  mockGetBookHighlights.mockResolvedValue([])
  mockUpsertBookHighlight.mockReset()
  mockUpsertBookHighlight.mockImplementation(async (h: BookHighlightRust) => h)
  mockDeleteBookHighlight.mockReset()
  mockDeleteBookHighlight.mockResolvedValue(undefined)
  mockCreateOrUpdateNoteBlock.mockReset()
  mockCreateOrUpdateNoteBlock.mockImplementation(async (input: { highlight: BookHighlightRust }) => {
    // 回显：新建路径回填 block_id；更新路径原样返回
    if (input.highlight.block_id) {
      return { blockId: input.highlight.block_id, created: false, highlight: input.highlight }
    }
    return {
      blockId: 'b-new',
      created: true,
      highlight: { ...input.highlight, block_id: 'b-new' },
    }
  })
  mockLoadNoteText.mockReset()
  mockLoadNoteText.mockResolvedValue('')
  mockListen.mockReset()
  mockListen.mockImplementation(async () => vi.fn())
  useReaderTypography().updateTypography({
    fontSize: 17, lineHeight: 1.8, maxWidthCh: 42, theme: 'light',
  })
  localStorage.removeItem('comind-reader-typography')
  highlightRegistry().clear()
  document.getSelection()?.removeAllRanges()
})

afterEach(() => {
  document.body.innerHTML = ''
  document.getSelection()?.removeAllRanges()
  // 清理 query cfi 用例可能残留的地址栏状态
  window.history.replaceState(null, '', '/')
})

// ---- 票 06：写笔记（选区操作条入口） ----

describe('ReaderView（票 06 写笔记）', () => {
  it('选区 → 操作条「写笔记」→ 先落高亮行 → 输入浮层（BasePopover 外壳）→ 提交：service 接管四件套+回填', async () => {
    mockLoadBook.mockResolvedValue(makeBook())
    const wrapper = mountReader()
    await flushPromises()

    // 选中首章段落前 3 字 → 操作条浮现 → 点「写笔记」
    selectText(wrapper, 'p', 0, 3)
    await flushPromises()
    const toolbar = document.body.querySelector('.selection-toolbar')!
    expect(toolbar).toBeTruthy()
    toolbar.querySelector<HTMLButtonElement>('button[title="写笔记"]')!.click()
    await flushPromises()

    // D7：写笔记先锚定高亮行（block_id=null，与「高亮」按钮同款落库）
    expect(mockUpsertBookHighlight).toHaveBeenCalledTimes(1)
    const hl = mockUpsertBookHighlight.mock.calls[0][0] as BookHighlightRust
    expect(hl.block_id).toBeNull()
    expect(hl.text).toBe('第一章')
    expect(hl.book_page_id).toBe('book-1')

    // 输入浮层出现（quote 上下文展示已移除，仅保留输入区）
    expect(document.body.querySelector('.note-input-popover')).toBeTruthy()

    // 填写想法并保存
    fillNoteText('我的想法')
    submitNote()
    await flushPromises()

    // service 接管：四件套 + 高亮行 + 想法文本
    expect(mockCreateOrUpdateNoteBlock).toHaveBeenCalledTimes(1)
    const input = mockCreateOrUpdateNoteBlock.mock.calls[0][0]
    expect(input.text).toBe('我的想法')
    expect(input.bookPageId).toBe('book-1')
    expect(input.bookTitle).toBe('测试书')
    expect(input.chapter).toBe('第一章')
    expect(input.quote).toBe('第一章')
    expect(input.cfi.startsWith('epubcfi(/6/2!')).toBe(true)
    expect(input.highlight.id).toBe(hl.id)

    // 提交后浮层关闭
    expect(document.body.querySelector('.note-input-popover')).toBeNull()
    wrapper.unmount()
  })

  it('空文本提交无效（浮层不关、service 不调）', async () => {
    mockLoadBook.mockResolvedValue(makeBook())
    const wrapper = mountReader()
    await flushPromises()

    selectText(wrapper, 'p', 0, 3)
    await flushPromises()
    document.body.querySelector('.selection-toolbar')!
      .querySelector<HTMLButtonElement>('button[title="写笔记"]')!.click()
    await flushPromises()

    submitNote()
    await flushPromises()

    expect(mockCreateOrUpdateNoteBlock).not.toHaveBeenCalled()
    expect(document.body.querySelector('.note-input-popover')).toBeTruthy()
    wrapper.unmount()
  })

  it('点已有高亮（无 block_id）→ 浮层「写笔记」→ 提交：service 带该高亮行', async () => {
    // 先造覆盖首章段落开头的高亮 CFI
    mockLoadBook.mockResolvedValue(makeBook())
    const probe = mountReader()
    await flushPromises()
    const contentEl = probe.get('.chapter-content').element as HTMLElement
    const textNode = contentEl.querySelector('p')!.firstChild!
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, 3)
    const cfi = cfiFromRange(contentEl, range, 0)
    probe.unmount()

    mockLoadBook.mockResolvedValue(makeBook())
    mockGetBookHighlights.mockResolvedValue([makeHighlight('hl-1', cfi, '第一章')])
    const wrapper = mountReader()
    await flushPromises()

    // 点已有高亮 → 高亮浮层 →「写笔记」
    await wrapper.get('.chapter-content p').trigger('click')
    const popover = document.body.querySelector('.highlight-popover')!
    expect(popover).toBeTruthy()
    popover.querySelector<HTMLButtonElement>('button[title="写笔记"]')!.click()
    await flushPromises()

    // 不重复落高亮行（已有），输入浮层直接出现
    expect(mockUpsertBookHighlight).not.toHaveBeenCalled()
    expect(document.body.querySelector('.note-input-popover')).toBeTruthy()

    fillNoteText('对这句的想法')
    submitNote()
    await flushPromises()

    expect(mockCreateOrUpdateNoteBlock).toHaveBeenCalledTimes(1)
    const input = mockCreateOrUpdateNoteBlock.mock.calls[0][0]
    expect(input.highlight.id).toBe('hl-1')
    expect(input.quote).toBe('第一章')
    expect(input.cfi).toBe(cfi)
    wrapper.unmount()
  })

  it('已有 block_id 的高亮再写：浮层预填旧笔记文本，提交走更新路径', async () => {
    mockLoadBook.mockResolvedValue(makeBook())
    const probe = mountReader()
    await flushPromises()
    const contentEl = probe.get('.chapter-content').element as HTMLElement
    const textNode = contentEl.querySelector('p')!.firstChild!
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, 3)
    const cfi = cfiFromRange(contentEl, range, 0)
    probe.unmount()

    mockLoadBook.mockResolvedValue(makeBook())
    mockGetBookHighlights.mockResolvedValue([makeHighlight('hl-1', cfi, '第一章', 'b-1')])
    mockLoadNoteText.mockResolvedValue('旧想法')
    const wrapper = mountReader()
    await flushPromises()

    await wrapper.get('.chapter-content p').trigger('click')
    document.body.querySelector('.highlight-popover')!
      .querySelector<HTMLButtonElement>('button[title="写笔记"]')!.click()
    await flushPromises()

    // 预填旧文（loadNoteText 从库读取）
    const textarea = document.body.querySelector('.note-input-popover textarea') as HTMLTextAreaElement
    expect(mockLoadNoteText).toHaveBeenCalledWith('b-1')
    expect(textarea.value).toBe('旧想法')

    // 改写并保存
    fillNoteText('新想法')
    submitNote()
    await flushPromises()

    expect(mockCreateOrUpdateNoteBlock).toHaveBeenCalledTimes(1)
    expect(mockCreateOrUpdateNoteBlock.mock.calls[0][0].text).toBe('新想法')
    expect(mockCreateOrUpdateNoteBlock.mock.calls[0][0].highlight.block_id).toBe('b-1')
    wrapper.unmount()
  })
})

// ---- 票 06：跳回原文（跨窗口事件 + URL query） ----

describe('ReaderView（票 06 跳回原文）', () => {
  /** 生成一条指向第二章段落开头的 CFI（真实链路：同构 DOM） */
  async function makeChapter2Cfi(): Promise<string> {
    mockLoadBook.mockResolvedValue(makeBook())
    const probe = mountReader()
    await flushPromises()
    await probe.get('button[title="下一章"]').trigger('click')
    await flushPromises()
    const contentEl = probe.get('.chapter-content').element as HTMLElement
    const textNode = contentEl.querySelector('p')!.firstChild!
    const anchor = document.createRange()
    anchor.setStart(textNode, 0)
    anchor.setEnd(textNode, 2)
    const cfi = cfiFromRange(contentEl, anchor, 1)
    probe.unmount()
    return cfi
  }

  it('reader:jump-to 事件（已存在窗口路径）：切章 + scrollIntoView + 闪烁提示', async () => {
    const cfi = await makeChapter2Cfi()

    mockLoadBook.mockResolvedValue(makeBook())
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      const wrapper = mountReader()
      await flushPromises()

      // 主窗口「↗ 原文」emitTo 命中已存在阅读器窗口的监听
      fireListenEvent('reader:jump-to', { bookPageId: 'book-1', cfi })
      await flushPromises()

      // 切到第二章并定位（block: 'center'）
      expect(wrapper.get('.chapter-content').text()).toContain('第二章内容')
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(scrollIntoView.mock.calls[0][0]).toEqual({ block: 'center' })
      const target = scrollIntoView.mock.contexts[0] as Element
      expect(target.tagName).toBe('P')
      expect(target.textContent).toBe('第二章内容')
      // 闪烁提示：跳转目标注册进绘制层（一次性，约 1.6s 后自动移除）
      const flash = highlightRegistry().get('reader-jump-flash')
      expect(flash).toBeInstanceOf(FakeHighlight)
      expect(flash!.ranges[0].toString()).toBe('第二')
      wrapper.unmount()
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  it('其他书的事件不响应（bookPageId 不匹配忽略）', async () => {
    const cfi = await makeChapter2Cfi()

    mockLoadBook.mockResolvedValue(makeBook())
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      const wrapper = mountReader()
      await flushPromises()

      fireListenEvent('reader:jump-to', { bookPageId: 'book-other', cfi })
      await flushPromises()

      // 仍停在第一章，不定位不闪烁
      expect(wrapper.get('.chapter-content').text()).toContain('第一章内容')
      expect(scrollIntoView).not.toHaveBeenCalled()
      expect(highlightRegistry().get('reader-jump-flash')).toBeUndefined()
      wrapper.unmount()
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  it('新建窗口路径：URL query 携带 cfi，开书即定位并一次性消费（query 清除）', async () => {
    const cfi = await makeChapter2Cfi()

    mockLoadBook.mockResolvedValue(makeBook())
    window.history.replaceState(null, '', `/reader/book-1?cfi=${encodeURIComponent(cfi)}`)
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      const wrapper = mountReader()
      await flushPromises()

      // 前缀 /6/4 定位 spine 序号 1（第二章）：开书即切章定位
      expect(wrapper.get('.chapter-content').text()).toContain('第二章内容')
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(scrollIntoView.mock.contexts[0]).toBeTruthy()
      // 一次性消费：地址栏 query 已清除（刷新不重复跳转）
      expect(window.location.search).not.toContain('cfi=')
      wrapper.unmount()
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
      window.history.replaceState(null, '', '/')
    }
  })

  it('书未加载完成时收到事件：挂起待 ready 后再跳（事件早于加载的竞态）', async () => {
    const cfi = await makeChapter2Cfi()

    // 书加载人为延迟，事件先到
    let resolveLoad: (book: EPUB) => void = () => {}
    mockLoadBook.mockImplementation(() => new Promise<EPUB>(resolve => {
      resolveLoad = resolve
    }))
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      const wrapper = mountReader()
      await flushPromises()

      // 书未加载完（loading 态）时事件已到达
      fireListenEvent('reader:jump-to', { bookPageId: 'book-1', cfi })
      await flushPromises()
      expect(scrollIntoView).not.toHaveBeenCalled()

      resolveLoad(makeBook())
      await flushPromises()

      // 加载完成后消费挂起的跳转
      expect(wrapper.get('.chapter-content').text()).toContain('第二章内容')
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      wrapper.unmount()
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })
})
