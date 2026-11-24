/**
 * TaskHub 任务数据源口径测试（2026-10-13 口径修订，取代 ADR-0050 D4 的 tag 闭包口径）。
 *
 * 全视图共同约束：(1) status 非空（字段写入即任务，不要求挂 #任务）(2) content 非空。
 * 组件谓词（searchedCards）的接线测试 —— 卡片投影经 mock client 精确控制
 * （WASM 端 getBlockCards 恒返回 []，真实库测不了过滤，故全 mock）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import TaskHub from './TaskHub.vue'
import type { BlockCard } from '../../wasm/types'

// jsdom 无 matchMedia；CodeMirrorEditor→useTheme 在模块级求值会调用它（先例：TaskHub.test.ts）。
vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeEventListener: vi.fn(),
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

const { mockClient } = vi.hoisted(() => ({
  mockClient: {
    getFieldDefinitions: vi.fn(),
    getDeletedPresetFieldDefinitions: vi.fn().mockResolvedValue([]),
    getBlockCards: vi.fn(),
    getFieldValues: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock('../../wasm/client', () => ({
  initCoreClient: vi.fn().mockResolvedValue(mockClient),
  getCoreClient: vi.fn(() => mockClient),
}))

// WASM 客户端不支持 Screens/Tabs —— 轻量 store 桩（同 TaskHub.test.ts）。
vi.mock('../../stores/screenView', () => {
  const EMPTY_QUERY = { version: 1, filter: { combinator: 'and', children: [] }, sort: [], groupBy: null }
  return {
    useScreenViewStore: vi.fn(() => ({
      load: vi.fn(async () => []),
      workingQuery: { ...EMPTY_QUERY },
      currentViewType: 'table',
      currentTab: null,
    })),
    parseViewQuery: vi.fn(() => ({ ...EMPTY_QUERY })),
  }
})

function card(over: Partial<BlockCard> & { block_id: string }): BlockCard {
  return {
    page_id: 'page-1',
    parent_id: 'page-1',
    content_preview: 'content',
    properties: {},
    date_refs: [],
    tags: [],
    updated_at: 1000,
    created_at: 1000,
    ...over,
  }
}

/** 外壳桩：渲染副标题（flatCards.length = 数据源过滤后的任务数）与 items 的 block id。 */
const QueryPageFrameStub = defineComponent({
  name: 'QueryPageFrame',
  props: { subtitle: { type: String, default: '' }, items: { type: Array, default: () => [] } },
  setup(props, { slots }) {
    return () => h('div', { class: 'qpf-stub' }, [
      h('p', { class: 'qpf-subtitle' }, props.subtitle),
      h('div', { class: 'qpf-items' }, (props.items as Array<{ block_id: string }>).map((i) =>
        h('span', { class: 'qpf-item', 'data-block-id': i.block_id }, i.block_id),
      )),
      slots.quadrant?.({ context: {} }),
    ])
  },
})
const QuadrantViewStub = defineComponent({
  name: 'QuadrantView',
  emits: ['addItem', 'cellChange', 'openBlock'],
  setup() {
    return () => h('div', { class: 'quadrant-stub' })
  },
})

function mountTaskHub() {
  return mount(TaskHub, {
    global: {
      stubs: { QueryPageFrame: QueryPageFrameStub, QuadrantView: QuadrantViewStub, PageDrawer: true },
    },
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  mockClient.getFieldDefinitions.mockResolvedValue([
    { id: 'f-status', key: 'status', title: '状态', type: 'string', closed_values: null, default_value: null, hide_when: 'never', is_system: true, created_at: 1, updated_at: 1, version: 0, deleted_at: null },
  ])
})

describe('TaskHub — 数据源共同口径（status 非空 + content 非空，与 tag 无关）', () => {
  it('status 非空即入列（含未挂任务 tag / 已完成 Done）；status 空的块不入列', async () => {
    mockClient.getBlockCards.mockResolvedValue([
      card({ block_id: 't-untagged', tags: [], properties: { status: 'Todo' } }),          // 未挂 tag，字段写入即任务
      card({ block_id: 't-done', tags: [], properties: { status: 'Done' } }),              // 已完成（回归：D4 口径下曾消失）
      card({ block_id: 't-tagged', tags: ['sys-tag-system-task'], properties: { status: 'Doing' } }), // 挂 tag 的块同口径
      card({ block_id: 't-tag-no-status', tags: ['sys-tag-system-task'], properties: {} }), // 挂 tag 但 status 空
      card({ block_id: 't-empty-status', tags: [], properties: { status: '' } }),          // status 空串
      card({ block_id: 't-unrelated', tags: ['other-tag'], properties: {} }),              // 无关 tag 无 status
    ])

    const wrapper = mountTaskHub()
    await flushPromises()

    const ids = wrapper.findAll('.qpf-item').map((el) => el.attributes('data-block-id'))
    expect(ids).toContain('t-untagged')
    expect(ids).toContain('t-done')
    expect(ids).toContain('t-tagged')
    expect(ids).not.toContain('t-tag-no-status')
    expect(ids).not.toContain('t-empty-status')
    expect(ids).not.toContain('t-unrelated')
    // 副标题计数同口径：仅 3 个任务
    expect(wrapper.find('.qpf-subtitle').text()).toBe('3 个任务')
  })

  it('content 为空的块不入列（即使 status 非空）', async () => {
    mockClient.getBlockCards.mockResolvedValue([
      card({ block_id: 't-empty-content', properties: { status: 'Todo' }, content_preview: '' }),
      card({ block_id: 't-blank-content', properties: { status: 'Done' }, content_preview: '   ' }),
      card({ block_id: 't-ok', properties: { status: 'Todo' } }),
    ])

    const wrapper = mountTaskHub()
    await flushPromises()

    const ids = wrapper.findAll('.qpf-item').map((el) => el.attributes('data-block-id'))
    expect(ids).not.toContain('t-empty-content')
    expect(ids).not.toContain('t-blank-content')
    expect(ids).toContain('t-ok')
  })
})
