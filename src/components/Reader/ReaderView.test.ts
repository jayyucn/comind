// ReaderView 组件测试（票 03/04/05）：EPUB loader 与 wasm client mock
// （vitest + @vue/test-utils）。覆盖：首章渲染、上/下章切换与边界禁用、常驻
// 目录侧栏跳转（无遮罩）、书文件缺失错误态、章节图片资源替换（书内
// blob:/外链剥）、
// 票 04：进度恢复（CFI 跳章 + scrollIntoView 定位）、滚动 debounce 写进度、
// 关窗 flush、排版面板（主题 class + CSS 变量落地）。
// 票 05：选中→高亮→落库与绘制、重开原位重绘、解析失败静默跳过、
// 点已有高亮→删除浮层→仅删高亮行。
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import type { EPUB, EPUBSection } from 'foliate-js/epub.js'
import { cfiFromRange } from '../../services/epub-cfi'
import { useReaderTypography } from '../../composables/useReaderTypography'
import type { BookHighlightRust, BookProgressRust } from '../../wasm/types'

const {
  mockLoadBook, mockGetBookProgress, mockUpsertBookProgress,
  mockGetBookHighlights, mockUpsertBookHighlight, mockDeleteBookHighlight,
} = vi.hoisted(() => ({
  mockLoadBook: vi.fn(),
  mockGetBookProgress: vi.fn(),
  mockUpsertBookProgress: vi.fn(),
  mockGetBookHighlights: vi.fn(),
  mockUpsertBookHighlight: vi.fn(),
  mockDeleteBookHighlight: vi.fn(),
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

// 阅读器窗口为非 Tauri 环境（isTauri=false → 窗口控制全部早退，测试只验证 UI 逻辑）
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }))
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
// 票 04/05：进度/高亮走 client（组件测试 mock，内存态即可）
vi.mock('../../wasm/client', () => ({
  initCoreClient: async () => ({
    getBookProgress: mockGetBookProgress,
    upsertBookProgress: mockUpsertBookProgress,
    getBookHighlights: mockGetBookHighlights,
    upsertBookHighlight: mockUpsertBookHighlight,
    deleteBookHighlight: mockDeleteBookHighlight,
  }),
  isTauriEnvironment: () => false,
}))

import ReaderView from './ReaderView.vue'

/** 章节 mock：createDocument 返回 DOMParser 解析的 Document（真实链路由 foliate 解析 XHTML） */
function makeSection(id: string, bodyHtml: string): EPUBSection {
  return {
    id,
    createDocument: async () =>
      new DOMParser().parseFromString(`<html><body>${bodyHtml}</body></html>`, 'text/html'),
  }
}

/** EPUB 实例 mock：三章节 + 平铺 TOC + resolveHref 定位 */
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

/** 高亮记录构造（BookHighlightRust） */
function makeHighlight(id: string, cfi: string, text: string, chapter = '第一章'): BookHighlightRust {
  return {
    id,
    book_page_id: 'book-1',
    cfi,
    text,
    chapter,
    color: 'yellow',
    block_id: null,
    created_at: 1,
    updated_at: 1,
  }
}

/** 在正文容器内选中文本并派发 selectionchange（jsdom 选区事件不可靠，手动派发） */
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

function mountReader(bookId = 'book-1') {
  // attachTo document.body：jsdom 的 Selection.addRange 会静默忽略指向
  // detached 节点的 Range（rangeCount 保持 0），票 05 选区用例必须挂在真实文档上
  // pinia：票 07 高亮面板 setup 即取 blocks store（join 笔记摘要）
  return mount(ReaderView, {
    props: { bookId },
    attachTo: document.body,
    global: { plugins: [createPinia()] },
  })
}

// jsdom 未实现 URL.createObjectURL/revokeObjectURL，图片用例手工 stub
// 票 05：jsdom 无 CSS Custom Highlight API 且无全局 CSS 对象 →
// 在 globalThis 上 stub Highlight 构造器 + CSS.highlights 注册表
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
  mockLoadBook.mockReset()
  // 默认无进度/无高亮（现有用例不受恢复与重绘影响）
  mockGetBookProgress.mockReset()
  mockGetBookProgress.mockResolvedValue(null)
  mockUpsertBookProgress.mockReset()
  mockUpsertBookProgress.mockResolvedValue({} as BookProgressRust)
  mockGetBookHighlights.mockReset()
  mockGetBookHighlights.mockResolvedValue([])
  mockUpsertBookHighlight.mockReset()
  // upsert 回显输入（Rust 侧幂等回填场景的近似）
  mockUpsertBookHighlight.mockImplementation(async (h: BookHighlightRust) => h)
  mockDeleteBookHighlight.mockReset()
  mockDeleteBookHighlight.mockResolvedValue(undefined)
  // 排版偏好重置默认（模块级单例跨用例共享，避免用例间主题残留）
  useReaderTypography().updateTypography({
    fontSize: 17, lineHeight: 1.8, maxWidthCh: 42, theme: 'light',
  })
  localStorage.removeItem('comind-reader-typography')
  highlightRegistry().clear()
  document.getSelection()?.removeAllRanges()
})

afterEach(() => {
  // 清理 Teleport 到 body 的抽屉/面板/操作条残留
  document.body.innerHTML = ''
  document.getSelection()?.removeAllRanges()
})

describe('ReaderView', () => {
  it('打开即渲染第一章：顶栏书名/章节名 + 正文标题/段落', async () => {
    mockLoadBook.mockResolvedValue(makeBook())

    const wrapper = mountReader()
    await flushPromises()

    expect(wrapper.text()).toContain('测试书')
    expect(wrapper.text()).toContain('第一章')
    const content = wrapper.get('.chapter-content')
    expect(content.text()).toContain('第一章内容')
    expect(content.element.querySelector('h1')?.textContent).toBe('第一章')
  })

  it('上/下章切换正确，边界禁用（首章禁上、末章禁下）', async () => {
    mockLoadBook.mockResolvedValue(makeBook())

    const wrapper = mountReader()
    await flushPromises()

    const prevBtn = wrapper.get('button[title="上一章"]')
    const nextBtn = wrapper.get('button[title="下一章"]')

    // 首章：上一章禁用
    expect(prevBtn.attributes('disabled')).toBeDefined()
    expect(nextBtn.attributes('disabled')).toBeUndefined()

    await nextBtn.trigger('click')
    await flushPromises()
    expect(wrapper.get('.chapter-content').text()).toContain('第二章内容')

    await nextBtn.trigger('click')
    await flushPromises()
    expect(wrapper.get('.chapter-content').text()).toContain('第三章内容')

    // 末章：下一章禁用、上一章可用
    expect(nextBtn.attributes('disabled')).toBeDefined()
    expect(prevBtn.attributes('disabled')).toBeUndefined()

    await prevBtn.trigger('click')
    await flushPromises()
    expect(wrapper.get('.chapter-content').text()).toContain('第二章内容')
  })

  it('滚到底继续向下滚 → 自动翻到下一章（连读翻页）', async () => {
    mockLoadBook.mockResolvedValue(makeBook())

    const wrapper = mountReader()
    await flushPromises()
    expect(wrapper.get('.chapter-content').text()).toContain('第一章内容')

    // jsdom 无布局：scrollTop/clientHeight/scrollHeight 均为 0 → 视为已到底部
    const content = wrapper.get('.chapter-content').element as HTMLElement
    content.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }))
    await flushPromises()
    expect(wrapper.get('.chapter-content').text()).toContain('第二章内容')
  })

  it('未滚到底时向下滚不翻页', async () => {
    mockLoadBook.mockResolvedValue(makeBook())

    const wrapper = mountReader()
    await flushPromises()

    // 模拟未到底部：scrollTop + clientHeight < scrollHeight
    const content = wrapper.get('.chapter-content').element as HTMLElement
    Object.defineProperty(content, 'scrollTop', { value: 10, configurable: true })
    Object.defineProperty(content, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(content, 'clientHeight', { value: 500, configurable: true })
    content.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }))
    await flushPromises()

    expect(wrapper.get('.chapter-content').text()).toContain('第一章内容')
  })

  it('目录侧栏：列出目录、当前章高亮、点击跳转且侧栏常驻（无遮罩）', async () => {
    mockLoadBook.mockResolvedValue(makeBook())

    const wrapper = mountReader()
    await flushPromises()

    // 侧栏初始折叠（常驻布局内联于正文区，非 Teleport 浮层）
    expect(wrapper.get('.toc-drawer').classes()).toContain('collapsed')

    await wrapper.get('button[title="目录"]').trigger('click')
    const items = wrapper.findAll('.toc-item')
    expect(items).toHaveLength(3)
    expect(items[0].text()).toBe('第一章')
    // 当前章高亮
    expect(items[0].classes()).toContain('active')
    // 常驻侧栏无黑色遮罩
    expect(wrapper.find('.toc-overlay').exists()).toBe(false)

    // 点击第三章 → 跳转 + 侧栏保持展开（常驻，不随跳转关闭）
    await items[2].trigger('click')
    await flushPromises()
    expect(wrapper.get('.chapter-content').text()).toContain('第三章内容')
    expect(wrapper.get('.toc-drawer').classes()).not.toContain('collapsed')

    // 关闭侧栏 → 折叠
    await wrapper.get('.toc-close-btn').trigger('click')
    expect(wrapper.get('.toc-drawer').classes()).toContain('collapsed')
  })

  it('书文件缺失（票 01 遗留：落盘失败不回滚 Page）：显示友好错误态', async () => {
    mockLoadBook.mockRejectedValue(
      new Error('Failed to read book file: 系统找不到指定的文件。'),
    )

    const wrapper = mountReader('missing-book')
    await flushPromises()

    expect(wrapper.text()).toContain('无法打开这本书')
    expect(wrapper.text()).toContain('重新导入')
    // 原始错误信息一并展示，便于排查
    expect(wrapper.text()).toContain('Failed to read book file')
    expect(wrapper.find('.chapter-content').exists()).toBe(false)
  })

  it('章节图片：书内资源经 loadBlob 转 blob: URL，外链 src 被剥', async () => {
    const book = makeBook()
    ;(book.sections[0] as EPUBSection & { createDocument: () => Promise<Document> })
      .createDocument = async () =>
      new DOMParser().parseFromString(
        '<html><body>' +
          '<p>插图：<img src="images/pic.png" alt="书内插图"/></p>' +
          '<p><img src="https://evil.com/x.png" alt="外链图"/></p>' +
          '</body></html>',
        'text/html',
      )
    mockLoadBook.mockResolvedValue(book)

    const wrapper = mountReader()
    await flushPromises()

    const imgs = wrapper.findAll('.chapter-content img')
    expect(imgs).toHaveLength(2)
    // 书内资源：zip 内路径（section href 基准 resolve）→ loadBlob → blob: URL
    expect(book.loadBlob).toHaveBeenCalledWith('images/pic.png')
    expect(imgs[0].attributes('src')).toBe('blob:mock-object-url')
    expect(imgs[0].attributes('alt')).toBe('书内插图')
    // 外链：剥 src，标签与 alt 保留（faithful）
    expect(imgs[1].attributes('src')).toBeUndefined()
    expect(imgs[1].attributes('alt')).toBe('外链图')
  })

  it('无 TOC 的书：目录按钮可展开侧栏（空列表），正文照常渲染', async () => {
    const book = makeBook()
    ;(book as unknown as { toc: unknown }).toc = null
    mockLoadBook.mockResolvedValue(book)

    const wrapper = mountReader()
    await flushPromises()

    expect(wrapper.get('.chapter-content').text()).toContain('第一章内容')

    await wrapper.get('button[title="目录"]').trigger('click')
    expect(wrapper.findAll('.toc-item')).toHaveLength(0)
  })

  // ---- 票 04：阅读进度 ----

  it('读到第二章关窗重开：跳回原章并解析 CFI 定位（scrollIntoView）', async () => {
    // 第一次打开 → 切到第二章 → 从渲染 DOM 生成进度 CFI（真实链路：可视区文本）
    mockLoadBook.mockResolvedValue(makeBook())
    const first = mountReader()
    await flushPromises()
    await first.get('button[title="下一章"]').trigger('click')
    await flushPromises()
    const contentEl = first.get('.chapter-content').element as HTMLElement
    expect(contentEl.textContent).toContain('第二章内容')

    const textNode = contentEl.querySelector('p')!.firstChild!
    const anchor = document.createRange()
    anchor.setStart(textNode, 0)
    anchor.setEnd(textNode, 0)
    const cfi = cfiFromRange(contentEl, anchor, 1)
    first.unmount()

    // 重开：进度指向第二章 → 自动跳章 + 解析定位（jsdom 无 scrollIntoView，stub 记录）
    mockLoadBook.mockResolvedValue(makeBook())
    mockGetBookProgress.mockResolvedValue({ book_page_id: 'book-1', cfi, updated_at: 0 })
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      const second = mountReader()
      await flushPromises()

      const content = second.get('.chapter-content')
      // 前缀 /6/4 定位 spine 序号 1（第二章）
      expect(content.text()).toContain('第二章内容')
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      // 定位目标是段落（进度锚点所在元素），且 block: 'start'
      expect(scrollIntoView.mock.calls[0][0]).toEqual({ block: 'start' })
      const target = scrollIntoView.mock.contexts[0] as Element
      expect(target.tagName).toBe('P')
      expect(target.textContent).toBe('第二章内容')
      second.unmount()
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  it('滚动 1s（debounce）后写进度：CFI 前缀对应当前章 spine 序号', async () => {
    mockLoadBook.mockResolvedValue(makeBook())
    vi.useFakeTimers()
    try {
      const wrapper = mountReader()
      await flushPromises()

      await wrapper.get('.chapter-content').trigger('scroll')
      // 未到 1s 不写
      vi.advanceTimersByTime(999)
      expect(mockUpsertBookProgress).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      await flushPromises()

      expect(mockUpsertBookProgress).toHaveBeenCalledTimes(1)
      const [pageId, cfi] = mockUpsertBookProgress.mock.calls[0] as [string, string]
      expect(pageId).toBe('book-1')
      // 首章（spineIndex 0）前缀为 /6/2
      expect(cfi.startsWith('epubcfi(/6/2!')).toBe(true)
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('关窗（unmount）时 flush 待写的 debounce 进度', async () => {
    mockLoadBook.mockResolvedValue(makeBook())
    const wrapper = mountReader()
    await flushPromises()

    // 滚动后未满 1s 直接关窗 → 立即保存
    await wrapper.get('.chapter-content').trigger('scroll')
    wrapper.unmount()
    await flushPromises()

    expect(mockUpsertBookProgress).toHaveBeenCalledTimes(1)
  })

  // ---- 票 04：排版控制 ----

  it('排版面板：字号/行距/行宽步进 + 主题切换（class 与 CSS 变量落地）', async () => {
    mockLoadBook.mockResolvedValue(makeBook())
    const wrapper = mountReader()
    await flushPromises()

    // 打开面板（Teleport 到 body）
    await wrapper.get('button[title="排版"]').trigger('click')
    const panel = document.body.querySelector('.typography-panel')
    expect(panel).toBeTruthy()

    // 默认值落地（mount 时应用一次）
    const rootEl = wrapper.get('.reader-window').element as HTMLElement
    expect(rootEl.style.getPropertyValue('--reader-font-size')).toBe('17px')
    expect(rootEl.style.getPropertyValue('--reader-line-height')).toBe('1.8')
    expect(rootEl.style.getPropertyValue('--reader-max-width')).toBe('42ch')

    // 字号 + 一步（19px）
    const plusBtn = Array.from(panel!.querySelectorAll<HTMLButtonElement>('.step-btn'))
      .find(b => b.title === '增大字号')!
    plusBtn.click()
    await flushPromises()
    expect(rootEl.style.getPropertyValue('--reader-font-size')).toBe('19px')

    // 切夜间主题：主题 class 切换 + 面板可重复调
    const darkBtn = Array.from(panel!.querySelectorAll<HTMLButtonElement>('.theme-btn'))
      .find(b => b.textContent?.trim() === '夜间')!
    darkBtn.click()
    await flushPromises()
    expect(wrapper.get('.reader-window').classes()).toContain('reader-theme-dark')

    // 点面板外关闭（Teleport 浮层 + 外点关闭）
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flushPromises()
    expect(document.body.querySelector('.typography-panel')).toBeNull()
    expect(wrapper.get('.reader-window').classes()).toContain('reader-theme-dark')

    // 偏好已写入 localStorage（跨会话记住）
    expect(JSON.parse(localStorage.getItem('comind-reader-typography')!).theme).toBe('dark')
    wrapper.unmount()
  })

  // ---- 票 05：高亮浮层（CFI 锚定） ----

  it('选中正文 → 操作条「高亮」：CFI/文本快照/章节名落库并即时绘制', async () => {
    mockLoadBook.mockResolvedValue(makeBook())
    const wrapper = mountReader()
    await flushPromises()

    // 选中首章段落前 3 字「第一章」→ 操作条浮现（Teleport 到 body）
    selectText(wrapper, 'p', 0, 3)
    await flushPromises()
    const toolbar = document.body.querySelector('.selection-toolbar')
    expect(toolbar).toBeTruthy()

    // 点「高亮」：选区 Range → CFI → upsert（含文本快照/章节名快照）
    toolbar!.querySelector<HTMLButtonElement>('button[title="高亮"]')!.click()
    await flushPromises()

    expect(mockUpsertBookHighlight).toHaveBeenCalledTimes(1)
    const saved = mockUpsertBookHighlight.mock.calls[0][0] as BookHighlightRust
    expect(saved.book_page_id).toBe('book-1')
    expect(saved.text).toBe('第一章')
    expect(saved.chapter).toBe('第一章') // 顶栏章节名（TOC 快照）
    expect(saved.color).toBe('yellow')
    expect(saved.block_id).toBeNull()
    // 首章（spineIndex 0）前缀为 /6/2
    expect(saved.cfi.startsWith('epubcfi(/6/2!')).toBe(true)

    // 绘制层：CSS Custom Highlight 注册表收到 1 个 range，覆盖选中文本
    const drawn = highlightRegistry().get('reader-highlight')
    expect(drawn).toBeInstanceOf(FakeHighlight)
    expect(drawn!.ranges).toHaveLength(1)
    expect(drawn!.ranges[0].toString()).toBe('第一章')

    // 划线完成清选区
    expect(document.getSelection()?.isCollapsed).toBe(true)
    wrapper.unmount()
  })

  it('操作条「取消」：清选区、不落库、不绘制', async () => {
    mockLoadBook.mockResolvedValue(makeBook())
    const wrapper = mountReader()
    await flushPromises()

    selectText(wrapper, 'p', 0, 3)
    await flushPromises()
    const toolbar = document.body.querySelector('.selection-toolbar')
    expect(toolbar).toBeTruthy()

    toolbar!.querySelector<HTMLButtonElement>('button[title="取消"]')!.click()
    await flushPromises()

    expect(mockUpsertBookHighlight).not.toHaveBeenCalled()
    expect(highlightRegistry().get('reader-highlight')).toBeUndefined()
    expect(document.getSelection()?.isCollapsed).toBe(true)
    wrapper.unmount()
  })

  it('重开书：已存高亮从库读取并原位重绘', async () => {
    // 第一次打开 → 从渲染 DOM 生成高亮 CFI（真实链路：重绘解析同构 DOM）
    mockLoadBook.mockResolvedValue(makeBook())
    const first = mountReader()
    await flushPromises()
    const contentEl = first.get('.chapter-content').element as HTMLElement
    const textNode = contentEl.querySelector('p')!.firstChild!
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, 5)
    const cfi = cfiFromRange(contentEl, range, 0)
    first.unmount()

    // 重开：高亮列表返回该条 → 渲染完成后原位重绘
    mockLoadBook.mockResolvedValue(makeBook())
    mockGetBookHighlights.mockResolvedValue([makeHighlight('hl-1', cfi, '第一章内容')])
    const second = mountReader()
    await flushPromises()

    expect(mockGetBookHighlights).toHaveBeenCalledWith('book-1')
    const drawn = highlightRegistry().get('reader-highlight')
    expect(drawn).toBeTruthy()
    expect(drawn!.ranges).toHaveLength(1)
    expect(drawn!.ranges[0].toString()).toBe('第一章内容')
    second.unmount()
  })

  it('高亮 CFI 解析失败（书文件变更后锚点失效）：静默跳过，不阻塞渲染', async () => {
    // 先造一条有效 CFI（好条目）
    mockLoadBook.mockResolvedValue(makeBook())
    const probe = mountReader()
    await flushPromises()
    const contentEl = probe.get('.chapter-content').element as HTMLElement
    const textNode = contentEl.querySelector('p')!.firstChild!
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, 3)
    const goodCfi = cfiFromRange(contentEl, range, 0)
    probe.unmount()

    // 坏条目（深路径越界）+ 好条目混入：只有好条目绘制
    mockLoadBook.mockResolvedValue(makeBook())
    mockGetBookHighlights.mockResolvedValue([
      makeHighlight('hl-bad', 'epubcfi(/6/2!/4/2/999/999:0)', '坏锚点'),
      makeHighlight('hl-good', goodCfi, '第一章'),
    ])
    const wrapper = mountReader()
    await flushPromises()

    const drawn = highlightRegistry().get('reader-highlight')!
    expect(drawn.ranges).toHaveLength(1)
    expect(drawn.ranges[0].toString()).toBe('第一章')
    // 正文渲染不受坏条目影响
    expect(wrapper.get('.chapter-content').text()).toContain('第一章内容')
    wrapper.unmount()
  })

  it('点已有高亮 → 删除浮层 → 「删除」仅删高亮行，正文文字保留', async () => {
    // 先造一条覆盖首章段落开头的高亮 CFI
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
    expect(highlightRegistry().get('reader-highlight')!.ranges).toHaveLength(1)

    // 点击正文（jsdom 无 caretRangeFromPoint → 退化为点击目标首个文本节点开头，
    // 落在高亮覆盖范围内 → 命中）→ 删除浮层浮现
    await wrapper.get('.chapter-content p').trigger('click')
    const popover = document.body.querySelector('.highlight-popover')
    expect(popover).toBeTruthy()

    // 点「删除」：delete_book_highlight 仅按 id 删高亮行
    popover!.querySelector<HTMLButtonElement>('button.popover-btn.danger')!.click()
    await flushPromises()

    expect(mockDeleteBookHighlight).toHaveBeenCalledWith('hl-1')
    // 绘制层清空、浮层收起
    expect(highlightRegistry().get('reader-highlight')).toBeUndefined()
    expect(document.body.querySelector('.highlight-popover')).toBeNull()
    // 正文文字保留（删高亮不改 DOM）
    expect(wrapper.get('.chapter-content').text()).toContain('第一章内容')
    wrapper.unmount()
  })
})
