/**
 * tag 聚合页测试（ADR-0050 D7）。
 *
 * 接缝：只 mock `src/wasm/client` 边界（视图导航工具另 mock，因其依赖 vue-router）——
 * tags / blockCard / pages / screenView 四个真 store + 真查询引擎 + 真 QueryPageFrame/TableView
 * 全真（先例：`TagsLibrary.test.ts` 的边界 mock × `TaskHub.test.ts` 的页面级 mount）。
 *
 * 覆盖：聚合口径（自身 + 后代闭包）、副标题、零配置统计卡（成员恒显 / 数值字段 sum+avg /
 * 非数值不出）、按 tag 有效字段生成的默认列、来源页标题映射、搜索过滤。
 * Rust 侧的解析与闭包另由 `cargo test -p comind-core` 覆盖。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import TagAggregatePage from './TagAggregatePage.vue'
import type { PersistedTagTreeEntry, PersistedFieldDefinition } from '../../types/tag-persisted'
import type { BlockCard, ScreenViewRust } from '../../wasm/types'

const { mockInitCoreClient, mockClient, navigateToTagLibraryMock } = vi.hoisted(() => ({
  mockInitCoreClient: vi.fn(),
  mockClient: {
    getTagTree: vi.fn(),
    getFieldDefinitions: vi.fn(),
    getBlockCards: vi.fn(),
    getAllPages: vi.fn(),
    getScreenViews: vi.fn(),
    createScreen: vi.fn(),
    createTab: vi.fn(),
    // PageDrawer 内的 Page 挂载会拉该页块 / 属性、并触发一次自动保存；不桩会漏出未处理
    // rejection（非断言失败，但污染信号）。
    getBlocksByPage: vi.fn().mockResolvedValue([]),
    getProperties: vi.fn().mockResolvedValue([]),
    saveBlockTree: vi.fn().mockResolvedValue([{}]),
  },
  navigateToTagLibraryMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../wasm/client', () => ({
  initCoreClient: mockInitCoreClient,
  getCoreClient: vi.fn(),
}))

// 导航工具依赖 vue-router（本文件不装路由）→ 边界桩替换。
vi.mock('../../composables/useNavigateToTag', () => ({
  useNavigateToTag: () => ({
    navigateToTag: vi.fn().mockResolvedValue(undefined),
    navigateToTagLibrary: navigateToTagLibraryMock,
  }),
}))

// jsdom 无 matchMedia；CodeMirrorEditor→useTheme 在模块级求值会调用它（先例：TaskHub.test.ts）。
vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

function treeEntry(
  over: Partial<PersistedTagTreeEntry> & { id: string; title: string },
): PersistedTagTreeEntry {
  return {
    field_ids: [],
    parent_id: null,
    is_system: false,
    created_at: 1,
    updated_at: 1,
    version: 0,
    deleted_at: null,
    effective_field_ids: [],
    descendant_ids: [],
    ...over,
  }
}

function fieldDef(
  over: Partial<PersistedFieldDefinition> & { id: string; title: string },
): PersistedFieldDefinition {
  return {
    key: over.id,
    type: 'string',
    closed_values: null,
    is_system: false,
    created_at: 1,
    updated_at: 1,
    version: 0,
    deleted_at: null,
    ...over,
  }
}

function makeCard(over: Partial<BlockCard> = {}): BlockCard {
  return {
    block_id: 'block-1',
    page_id: 'page-1',
    parent_id: 'page-1',
    content_preview: 'Test content',
    properties: {},
    date_refs: [],
    tags: [],
    updated_at: 1000,
    created_at: 1000,
    ...over,
  }
}

/** 一个 Screen + 一个 Tab；config 空串 → 列配置回退聚合页的 tag 字段模板。 */
function screenViews(entity: string): ScreenViewRust[] {
  const base = {
    entity,
    query_json: '',
    group_by: '',
    config: '',
    created_at: 1,
    updated_at: 1,
  }
  return [
    { ...base, id: 'sv-screen', parent_id: '', name: '全部成员', view_type: 'table', is_default: 1, sort_order: 0 },
    { ...base, id: 'sv-tab', parent_id: 'sv-screen', name: '', view_type: 'table', is_default: 0, sort_order: 1 },
  ]
}

const SYSTEM_TASK = treeEntry({
  id: 'sys-tag-system-task',
  title: '系统任务',
  field_ids: ['f-status'],
  is_system: true,
  effective_field_ids: ['f-status'],
})

// 项目：自身声明 负责人(string) + 预算(number)；后代含 开发任务
const PROJECT = treeEntry({
  id: 't-project',
  title: '项目',
  field_ids: ['f-owner', 'f-budget'],
  effective_field_ids: ['f-owner', 'f-budget'],
  descendant_ids: ['t-dev'],
})

// 开发任务：自身声明 工时(number)，继承父的 负责人（同名近者胜 → 工时在前）
const DEV_TASK = treeEntry({
  id: 't-dev',
  title: '开发任务',
  field_ids: ['f-estimate'],
  parent_id: 't-project',
  effective_field_ids: ['f-estimate', 'f-owner'],
})

describe('TagAggregatePage（tag 聚合页）', () => {
  // 组件在文件级静态引入（非每例 resetModules + dynamic import）：本页模块图最重
  // （TableView + 查询引擎 + CodeMirror），逐例重建曾在全套并发下顶穿 hookTimeout。
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()

    mockClient.getTagTree.mockResolvedValue([SYSTEM_TASK, PROJECT, DEV_TASK])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-status', title: '状态', is_system: true }),
      fieldDef({ id: 'f-owner', title: '负责人' }),
      fieldDef({ id: 'f-budget', title: '预算', type: 'number' }),
      fieldDef({ id: 'f-estimate', title: '工时', type: 'number' }),
    ])
    mockClient.getBlockCards.mockResolvedValue([
      makeCard({
        block_id: 'a',
        page_id: 'page-1',
        content_preview: '重构表格',
        tags: ['t-project'],
        properties: { 'f-owner': '张三', 'f-budget': 10 },
      }),
      makeCard({
        block_id: 'b',
        page_id: 'page-2',
        content_preview: '补测试',
        tags: ['t-dev'],
        properties: { 'f-estimate': 6, 'f-budget': 6 },
      }),
      // 未挂该 tag（含后代）的块：不得进入聚合结果
      makeCard({ block_id: 'c', page_id: 'page-2', content_preview: '无关块', tags: [] }),
    ])
    mockClient.getAllPages.mockResolvedValue([
      { id: 'page-1', block_id: null, title: '项目页', type: 'normal', icon: null, cover: null, aliases: '', file_path: null, children_count: 0, word_count: 0, deleted: 0, created_at: 1, updated_at: 1 },
      { id: 'page-2', block_id: null, title: '开发页', type: 'normal', icon: null, cover: null, aliases: '', file_path: null, children_count: 0, word_count: 0, deleted: 0, created_at: 1, updated_at: 1 },
    ])
    mockClient.getScreenViews.mockImplementation(async (entity: string) => screenViews(entity))
    mockInitCoreClient.mockResolvedValue(mockClient)
  })

  async function mountPage(tagId = 't-project') {
    const wrapper = mount(TagAggregatePage, { props: { tagId }, attachTo: document.body })
    await flushPromises()
    return wrapper
  }

  function texts(wrapper: { findAll: (s: string) => { text: () => string }[] }, sel: string) {
    return wrapper.findAll(sel).map((n) => n.text())
  }

  it('标题与副标题按聚合口径统计（自身 + 后代闭包）', async () => {
    const wrapper = await mountPage()
    // t-project 直系 1 个 + 后代 t-dev 1 个 = 2 个成员；来源页 page-1 / page-2 去重 = 2
    expect(texts(wrapper, '.page-title')).toContain('#项目')
    expect(wrapper.text()).toContain('2 个成员 · 来自 2 个页面')
  })

  it('表格只含命中集合的成员（未挂该 tag 及其后代的块被排除）', async () => {
    const wrapper = await mountPage()
    const contents = texts(wrapper, '.col-content')
    expect(contents.join(' ')).toContain('重构表格')
    expect(contents.join(' ')).toContain('补测试')
    expect(contents.join(' ')).not.toContain('无关块')
  })

  it('默认列 = 内容 + 来源页 + 该 tag 的全部有效字段', async () => {
    const wrapper = await mountPage()
    const headers = texts(wrapper, 'th')
    expect(headers).toEqual(expect.arrayContaining(['内容', '来源页', '负责人', '预算']))
    // 有效字段由 Rust 解析给出（f-owner / f-budget），列 key 与之对齐
    expect(wrapper.find('.col-f-owner').exists()).toBe(true)
    expect(wrapper.find('.col-f-budget').exists()).toBe(true)
  })

  it('来源页列把 page_id 映射为页标题', async () => {
    const wrapper = await mountPage()
    const pages = texts(wrapper, '.source-page-cell')
    expect(pages).toEqual(expect.arrayContaining(['项目页', '开发页']))
  })

  it('统计卡：成员恒显；数值字段自动出合计与平均；非数值字段不出卡', async () => {
    const wrapper = await mountPage()
    const labels = texts(wrapper, '.tag-stat-label')
    expect(labels).toContain('成员')
    expect(labels).toContain('预算合计')
    expect(labels).toContain('平均预算')
    // 负责人是 string → 不出统计卡
    expect(labels.join(' ')).not.toContain('负责人')

    const values = texts(wrapper, '.tag-stat-value')
    // 成员 2（聚合） / 预算 10 + 6 = 16 / 平均 8
    expect(values).toEqual(expect.arrayContaining(['2', '16', '8']))
  })

  it('成员数为 0 的 tag 仍渲染成员统计卡（恒显）', async () => {
    const wrapper = await mountPage('t-dev')
    // 开发任务：自身 1 个成员（补测试），有效字段 工时(number) + 负责人(string)
    expect(wrapper.text()).toContain('1 个成员 · 来自 1 个页面')
    expect(texts(wrapper, '.tag-stat-label')).toEqual(
      expect.arrayContaining(['成员', '工时合计', '平均工时']),
    )
    expect(texts(wrapper, '.tag-stat-value')).toEqual(expect.arrayContaining(['1', '6', '6']))
  })

  it('面包屑「标签 / #项目」点击返回标签管理页', async () => {
    const wrapper = await mountPage()
    expect(wrapper.find('.tag-crumb-current').text()).toBe('#项目')
    await wrapper.find('.tag-crumb-link').trigger('click')
    expect(navigateToTagLibraryMock).toHaveBeenCalled()
  })

  it('点击来源页单元格打开该成员块所属页面的抽屉', async () => {
    const wrapper = await mountPage()
    const cells = wrapper.findAll('td.col-page')
    expect(cells.length).toBe(2)

    await cells[0].trigger('click')
    await flushPromises()

    const drawer = wrapper.findComponent({ name: 'PageDrawer' })
    expect(drawer.props('pageId')).toBe('page-1')
  })

  it('搜索只收窄表格，不改统计值', async () => {
    const wrapper = await mountPage()
    const frame = wrapper.findComponent({ name: 'QueryPageFrame' })
    frame.vm.$emit('update:search', '补测试')
    await flushPromises()

    expect(texts(wrapper, '.col-content').join(' ')).not.toContain('重构表格')
    // 统计卡口径 = 该 tag 的成员集合，与搜索无关
    expect(wrapper.text()).toContain('2 个成员 · 来自 2 个页面')
    expect(texts(wrapper, '.tag-stat-value')).toEqual(expect.arrayContaining(['2', '16', '8']))
  })
})
