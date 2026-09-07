// GalleryView 单测（票 08）：generic 封面网格——标题/副标题经字段取值、封面 asset:// 解析、
// 进度环渲染、卡片点击 navigate、空态 slot 注入。assetStorage mock 隔离 IndexedDB/Tauri。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import type { FieldDescriptor } from '../../core/query'
import type { Page } from '../../types/page'

const { mockLoadUrl } = vi.hoisted(() => ({ mockLoadUrl: vi.fn() }))

vi.mock('../../utils/asset', () => ({
  assetStorage: { loadUrl: mockLoadUrl },
}))

import GalleryView from './GalleryView.vue'

function makePage(overrides: Partial<Page> = {}): Page {
  return {
    id: 'bk-1',
    blockId: null,
    title: '三体',
    type: 'book',
    icon: null,
    cover: 'asset://asset_cover_1',
    aliases: ['刘慈欣'],
    filePath: null,
    childrenCount: 0,
    wordCount: 0,
    createdAt: 0,
    updatedAt: 0,
    deleted: false,
    deletedAt: null,
    ...overrides,
  }
}

// 仿 Page 注册表：title(text) / aliases(multiSelect)
const fields: FieldDescriptor[] = [
  { key: 'title', label: '标题', type: 'text', get: (i) => (i as Page).title },
  { key: 'aliases', label: '别名', type: 'multiSelect', get: (i) => (i as Page).aliases ?? [] },
]

function mountGallery(props: Record<string, unknown> = {}) {
  return mount(GalleryView, {
    props: {
      items: [makePage()],
      fields,
      config: { viewKind: 'gallery', version: 1 },
      ...props,
    },
  })
}

beforeEach(() => {
  mockLoadUrl.mockReset()
  mockLoadUrl.mockImplementation(async (id: string) => `blob:mock-${id}`)
})

describe('GalleryView (generic, field-driven)', () => {
  it('卡片渲染标题与副标题（aliases[0]，作者约定）', () => {
    const wrapper = mountGallery()
    expect(wrapper.find('.card-title').text()).toBe('三体')
    expect(wrapper.find('.card-subtitle').text()).toBe('刘慈欣')
  })

  it('asset:// 封面经 assetStorage.loadUrl 解析为 blob URL', async () => {
    const wrapper = mountGallery()
    // watch immediate → 微任务后填充；flushPromises 等价
    await new Promise((r) => setTimeout(r, 0))
    expect(mockLoadUrl).toHaveBeenCalledWith('asset_cover_1')
    expect(wrapper.find('.cover-img').attributes('src')).toBe('blob:mock-asset_cover_1')
  })

  it('封面资产缺失（loadUrl 抛错）显示占位图标，不抛出', async () => {
    mockLoadUrl.mockRejectedValue(new Error('Asset not found'))
    const wrapper = mountGallery()
    await new Promise((r) => setTimeout(r, 0))
    expect(wrapper.find('.cover-img').exists()).toBe(false)
    expect(wrapper.find('.cover-placeholder').exists()).toBe(true)
  })

  it('无封面（cover=null）直接显示占位图标，不调 loadUrl', async () => {
    const wrapper = mountGallery({ items: [makePage({ id: 'bk-nocover', cover: null })] })
    await new Promise((r) => setTimeout(r, 0))
    expect(mockLoadUrl).not.toHaveBeenCalled()
    expect(wrapper.find('.cover-placeholder').exists()).toBe(true)
  })

  it('非 asset 协议封面直接作 img src（http 外链）', async () => {
    const wrapper = mountGallery({
      items: [makePage({ id: 'bk-http', cover: 'https://example.com/c.jpg' })],
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(mockLoadUrl).not.toHaveBeenCalled()
    expect(wrapper.find('.cover-img').attributes('src')).toBe('https://example.com/c.jpg')
  })

  it('progress 命中的卡片渲染进度环与百分比（50% ≈ 读过一半）', () => {
    const wrapper = mountGallery({ progress: { 'bk-1': 0.5 } })
    expect(wrapper.find('.card-progress').exists()).toBe(true)
    expect(wrapper.find('.progress-text').text()).toBe('50%')
    expect(wrapper.find('.ring-fg').attributes('stroke-dasharray')).toBeTruthy()
  })

  it('无进度数据（未读过的书）不渲染进度环', () => {
    const wrapper = mountGallery()
    expect(wrapper.find('.card-progress').exists()).toBe(false)
  })

  it('卡片点击 emit navigate(itemId)', async () => {
    const wrapper = mountGallery({ items: [makePage({ id: 'bk-click' })] })
    await wrapper.find('.gallery-card').trigger('click')
    expect(wrapper.emitted('navigate')).toBeTruthy()
    expect(wrapper.emitted('navigate')![0]).toEqual(['bk-click'])
  })

  it('空列表渲染空态，消费方可经 #empty slot 注入内容（导入入口）', () => {
    const wrapper = mount(GalleryView, {
      props: { items: [], fields, config: { viewKind: 'gallery', version: 1 } },
      slots: { empty: '<button class="import-cta">导入 EPUB</button>' },
    })
    expect(wrapper.find('.gallery-empty').exists()).toBe(true)
    expect(wrapper.find('.import-cta').text()).toBe('导入 EPUB')
  })

  it('空列表未注入 slot 时显示默认文案', () => {
    const wrapper = mountGallery({ items: [] })
    expect(wrapper.find('.gallery-empty').text()).toContain('暂无记录')
  })
})
