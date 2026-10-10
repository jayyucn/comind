/**
 * TaskHub 任务过滤 D4 口径测试（ADR-0050 阶段 2）。
 *
 * D4：数据源过滤从「status 值非空」切换为「block.tags 含系统 task tag（含后代闭包成员）」。
 * 组件谓词（taskHitTagIds + searchedCards）的接线测试 —— 卡片投影与标签树均经
 * mock client 精确控制（WASM 端 getBlockCards 恒返回 []，真实库测不了过滤，故全 mock；
 * 先例：TagsLibrary.test.ts 的边界 mock × 真 store）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import TaskHub from './TaskHub.vue'
import type { PersistedTagTreeEntry } from '../../types/tag-persisted'
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
    getTagTree: vi.fn(),
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

function treeEntry(
  over: Partial<PersistedTagTreeEntry> & { id: string; title: string },
): PersistedTagTreeEntry {
  return {
    field_ids: [],
    parent_id: null,
    description: '',
    color: '',
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

const TASK_TAG = treeEntry({
  id: 'task-tag',
  title: '任务',
  is_system: true,
  field_ids: ['f-status'],
  effective_field_ids: ['f-status'],
  descendant_ids: ['child-tag'],
})
const CHILD_TAG = treeEntry({
  id: 'child-tag',
  title: '开发任务',
  parent_id: 'task-tag',
  effective_field_ids: [],
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

/** 外壳桩：渲染副标题（flatCards.length = D4 过滤后的任务数）与 items 的 block id。 */
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
  mockClient.getTagTree.mockResolvedValue([TASK_TAG, CHILD_TAG])
  mockClient.getFieldDefinitions.mockResolvedValue([
    { id: 'f-status', key: 'status', title: '状态', type: 'string', closed_values: null, default_value: null, hide_when: 'never', is_system: true, created_at: 1, updated_at: 1, version: 0, deleted_at: null },
  ])
})

describe('TaskHub — D4 任务过滤按 tags 闭包', () => {
  it('挂任务闭包内 tag 的块入列（自身 + 子标签）；仅写 status 未挂载 / 无关 tag 的块不入列', async () => {
    mockClient.getBlockCards.mockResolvedValue([
      card({ block_id: 't-self', tags: ['task-tag'] }),          // 自身命中
      card({ block_id: 't-child', tags: ['child-tag'] }),        // 后代闭包命中
      card({ block_id: 't-status-only', tags: [], properties: { status: 'Todo' } }), // 旧口径会放行
      card({ block_id: 't-unrelated', tags: ['other-tag'] }),    // 无关 tag
    ])

    const wrapper = mountTaskHub()
    await flushPromises()

    const ids = wrapper.findAll('.qpf-item').map((el) => el.attributes('data-block-id'))
    expect(ids).toContain('t-self')
    expect(ids).toContain('t-child')
    expect(ids).not.toContain('t-status-only')
    expect(ids).not.toContain('t-unrelated')
    // 副标题计数同口径：仅 2 个任务
    expect(wrapper.find('.qpf-subtitle').text()).toBe('2 个任务')
  })

  it('标签树未就绪 / 无系统任务 tag 时降级回「status 非空」旧口径', async () => {
    mockClient.getTagTree.mockResolvedValue([]) // 无任何 tag → systemTaskTagId() = undefined
    mockClient.getBlockCards.mockResolvedValue([
      card({ block_id: 't-status-only', tags: [], properties: { status: 'Todo' } }),
      card({ block_id: 't-nothing', tags: ['whatever'] }),
    ])

    const wrapper = mountTaskHub()
    await flushPromises()

    const ids = wrapper.findAll('.qpf-item').map((el) => el.attributes('data-block-id'))
    expect(ids).toContain('t-status-only')
    expect(ids).not.toContain('t-nothing')
  })
})
