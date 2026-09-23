import { describe, it, expect, vi, beforeEach } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { Table } from 'lucide-vue-next'
import { createRegistry } from '../../core/query'
import type { CalendarConfig, TableConfig } from '../../core/view'
import { useScreenViewStore } from '../../stores/screenView'
import type { ScreenViewRust } from '../../wasm/types'
import QueryPageFrame from './QueryPageFrame.vue'
import FieldManagerPanel from '../query/FieldManagerPanel.vue'

/**
 * 列管理动作的接线回归（2026-09-23）。
 *
 * 外壳必须把「本页当前实际渲染的配置」（props.tableConfig）作为 store 写回的 transform 基准。
 * 漏传时，未注入 defaultConfig 的命名空间（tag 聚合页：列模板由 tag 字段异步派生，store 无从得知）
 * 会以空列集为基准 —— `columns.map(...)` 在空数组上跑一遍即把 `{"columns":[]}` 落库，
 * 渲染层随即失去自己的默认列回退 ⇒ 表格零列（用户可见症状：「拖拽列宽后数据被清空」，刷新不恢复）。
 */

const { mockUpdateTab } = vi.hoisted(() => ({ mockUpdateTab: vi.fn() }))

vi.mock('../../wasm/client', () => ({
  /**
   * 宽松 client：未声明的方法一律返回 async noop，避免挂载期其它模块取 client 时炸掉。
   * ⚠️ 必须显式让 `then` 为 undefined —— 否则 Proxy 对 `then` 也返回函数，会被 await 当成 thenable，
   * 调 `then(resolve, reject)` 时两个回调都被忽略 ⇒ 该 promise 永久 pending（getClient() 静默挂死）。
   */
  initCoreClient: vi.fn(async () => {
    const base: Record<string, unknown> = { updateTab: mockUpdateTab }
    return new Proxy(base, {
      get: (t, k) => (k === 'then' ? undefined : k in t ? t[k as string] : vi.fn(async () => undefined)),
    })
  }),
  getCoreClient: vi.fn(),
}))

/** 与 TagAggregateBody 同构：per-tag 命名空间 + 空 config（不注入 defaultConfig）。 */
const KEY = 'tag:query-page-frame-test'
const EMPTY_QUERY = { version: 1, filter: { combinator: 'and', children: [] }, sort: [], groupBy: null }

/** 该页的默认列模板：内容 + 来源页 + 一个 tag 字段列。 */
const TAG_BASE: TableConfig = {
  viewKind: 'table',
  version: 1,
  columns: [
    { key: 'content', role: 'primary', width: 720 },
    { key: 'page', width: 140 },
    { key: 'amount', width: 110 },
  ],
}

function makeView(overrides: Partial<ScreenViewRust>): ScreenViewRust {
  return {
    id: 'v',
    entity: KEY,
    parent_id: '',
    name: '',
    query_json: JSON.stringify(EMPTY_QUERY),
    view_type: 'table',
    group_by: '',
    is_default: 0,
    sort_order: 0,
    config: '',
    created_at: 0,
    updated_at: 0,
    ...overrides,
  }
}

function setupStore() {
  const store = useScreenViewStore(KEY, { defaultViewName: '全部成员' })
  store.views = [
    makeView({ id: 's1', is_default: 1, config: '{}' }),
    makeView({ id: 't1', parent_id: 's1', config: '' }),
  ]
  store.currentScreenId = 's1'
  store.currentTabId = 't1'
  return store
}

type ViewCtx = {
  onColumnResize: (changes: { key: string; width: number }[]) => void
  onColumnVisibility: (key: string, visible: boolean) => void
  onColumnAlign: (key: string, align: string) => void
  onColumnReset: (key: string) => void
}

/** 挂载外壳并从 `#table` slot 抓取 viewContext（消费方就是这样拿到列管理动作的）。 */
async function mountFrame() {
  const captured: { ctx?: ViewCtx } = {}
  const wrapper = mount(QueryPageFrame, {
    props: {
      title: '#demo',
      subtitle: '1 个成员',
      entityKey: 'block',
      screenViewKey: KEY,
      viewTypes: [{ key: 'table', label: '表格', icon: Table }],
      fields: [],
      registry: createRegistry(),
      items: [],
      groups: [],
      grouped: false,
      sort: [],
      groupBy: null,
      tableConfig: TAG_BASE,
      calendarConfig: { viewKind: 'calendar', version: 1 } as unknown as CalendarConfig,
    },
    slots: {
      table: (params: unknown) => {
        captured.ctx = (params as { context: ViewCtx }).context
        return h('div', { class: 'slot-probe' })
      },
    },
  })
  await flushPromises()
  return { wrapper, captured }
}

/** 最后一次 updateTab 写回的 config JSON。 */
function writtenConfig(callIndex = -1): TableConfig {
  const calls = mockUpdateTab.mock.calls
  const call = calls[callIndex < 0 ? calls.length - 1 : callIndex]
  return JSON.parse(call[4] as string) as TableConfig
}

describe('QueryPageFrame 列管理动作的写回基准', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mockUpdateTab.mockImplementation(
      async (id: string, name: string, viewType: string, queryJson: string, config: string) =>
        makeView({ id, name, view_type: viewType, query_json: queryJson, config, parent_id: 's1' }),
    )
  })

  it('列宽拖拽：以生效配置为基准，保留全部列（不落 columns:[]）', async () => {
    const store = setupStore()
    const { captured } = await mountFrame()
    expect(typeof captured.ctx?.onColumnResize).toBe('function')

    captured.ctx!.onColumnResize([{ key: 'content', width: 318 }])
    await flushPromises()

    expect(mockUpdateTab).toHaveBeenCalledTimes(1)
    const written = writtenConfig()
    expect(written.columns.map((c) => c.key)).toEqual(['content', 'page', 'amount'])
    expect(written.columns[0].width).toBe(318)
    // 写回后 store 侧解析出的列仍非空 —— 渲染层不会再拿到「空列集」
    expect(store.activeTabColumns).toHaveLength(3)
  })

  it('列显隐 / 对齐 / 重置列宽：同样以生效配置为基准', async () => {
    setupStore()
    const { captured } = await mountFrame()
    const ctx = captured.ctx!

    ctx.onColumnVisibility('page', false)
    ctx.onColumnAlign('amount', 'right')
    ctx.onColumnReset('content')
    await flushPromises()

    expect(mockUpdateTab).toHaveBeenCalledTimes(3)
    for (let i = 0; i < 3; i++) {
      expect(writtenConfig(i).columns.map((c) => c.key)).toEqual(['content', 'page', 'amount'])
    }
    // 各自的效果都落到了正确的列上
    expect(writtenConfig(0).columns.find((c) => c.key === 'page')?.visible).toBe(false)
    expect(writtenConfig(1).columns.find((c) => c.key === 'amount')?.align).toBe('right')
    expect(writtenConfig(2).columns.find((c) => c.key === 'content')?.width).toBeUndefined()
  })

  it('字段面板「已用字段」= 表格实际渲染的列（不是 store 侧回退的空列集）', async () => {
    const store = setupStore()
    const { wrapper } = await mountFrame()

    // 区分力前提：本命名空间无 defaultConfig ⇒ store 侧解析恰好是空列集
    expect(store.activeTabColumns).toHaveLength(0)

    await wrapper.find('button.hdr-btn[title="字段管理"]').trigger('click')
    await flushPromises()

    const panel = wrapper.findComponent(FieldManagerPanel)
    expect(panel.exists()).toBe(true)
    expect(panel.props('columns').map((c) => c.key)).toEqual(['content', 'page', 'amount'])
  })
})
