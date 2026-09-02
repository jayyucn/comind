// ReaderView 组件测试（票 03）：EPUB loader mock（vitest + @vue/test-utils）。
// 覆盖：首章渲染、上/下章切换与边界禁用、TOC 抽屉跳转、书文件缺失错误态、
// 章节图片资源替换（书内 blob:/外链剥）。
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { EPUB, EPUBSection } from 'foliate-js/epub.js'

const { mockLoadBook } = vi.hoisted(() => ({ mockLoadBook: vi.fn() }))

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

function mountReader(bookId = 'book-1') {
  return mount(ReaderView, { props: { bookId } })
}

// jsdom 未实现 URL.createObjectURL/revokeObjectURL，图片用例手工 stub
beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:mock-object-url')
  URL.revokeObjectURL = vi.fn()
})

beforeEach(() => {
  mockLoadBook.mockReset()
})

afterEach(() => {
  // 清理 Teleport 到 body 的抽屉残留
  document.body.innerHTML = ''
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

  it('TOC 抽屉：列出目录、当前章高亮、点击跳转并关闭抽屉', async () => {
    mockLoadBook.mockResolvedValue(makeBook())

    const wrapper = mountReader()
    await flushPromises()

    // 抽屉初始不可见
    expect(document.body.querySelector('.toc-drawer')).toBeNull()

    await wrapper.get('button[title="目录"]').trigger('click')
    // 抽屉 Teleport 到 body（ADR-0032 浮层纪律）
    const items = document.body.querySelectorAll('.toc-item')
    expect(items).toHaveLength(3)
    expect(items[0].textContent).toBe('第一章')
    // 当前章高亮
    expect(items[0].classList.contains('active')).toBe(true)

    // 点击第三章 → 跳转 + 抽屉关闭
    ;(items[2] as HTMLElement).click()
    await flushPromises()
    expect(wrapper.get('.chapter-content').text()).toContain('第三章内容')
    expect(document.body.querySelector('.toc-drawer')).toBeNull()
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

  it('无 TOC 的书：目录按钮可开抽屉（空列表），正文照常渲染', async () => {
    const book = makeBook()
    ;(book as unknown as { toc: unknown }).toc = null
    mockLoadBook.mockResolvedValue(book)

    const wrapper = mountReader()
    await flushPromises()

    expect(wrapper.get('.chapter-content').text()).toContain('第一章内容')

    await wrapper.get('button[title="目录"]').trigger('click')
    expect(document.body.querySelectorAll('.toc-item')).toHaveLength(0)
  })
})
