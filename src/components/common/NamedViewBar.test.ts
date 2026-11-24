import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import type { ScreenViewRust } from '../../wasm/types'

// ── Sortable.js mock：只测接线，不测 Sortable 内部 ──
const { capturedOptions, mockDestroy } = vi.hoisted(() => ({
  capturedOptions: {} as { current: Record<string, unknown> | null },
  mockDestroy: vi.fn(),
}))

vi.mock('sortablejs', () => ({
  default: class FakeSortable {
    constructor(_el: HTMLElement, opts: Record<string, unknown>) {
      capturedOptions.current = opts
    }
    destroy() {
      mockDestroy()
    }
  },
}))

// ── CoreClient mock：仅需 reorderScreenViews（load 不触发）+ updateTab（保存路径） ──
const { mockReorderScreenViews, mockUpdateTab } = vi.hoisted(() => ({
  mockReorderScreenViews: vi.fn(),
  mockUpdateTab: vi.fn(),
}))

vi.mock('../../wasm/client', () => ({
  initCoreClient: vi.fn(async () => ({ reorderScreenViews: mockReorderScreenViews, updateTab: mockUpdateTab })),
  getCoreClient: vi.fn(),
}))

import NamedViewBar from './NamedViewBar.vue'
import Sortable from 'sortablejs'
import { useScreenViewStore } from '../../stores/screenView'

const EMPTY_QUERY = { version: 1, filter: { combinator: 'and', children: [] }, sort: [], groupBy: null }

function makeScreen(overrides: Partial<ScreenViewRust> = {}): ScreenViewRust {
  return {
    id: 's1',
    entity: 'block',
    parent_id: '',
    name: 'Screen',
    query_json: '{}',
    view_type: 'table',
    group_by: '',
    is_default: 1,
    sort_order: 0,
    config: '{}',
    created_at: 1000,
    updated_at: 1000,
    ...overrides,
  }
}

function makeTab(overrides: Partial<ScreenViewRust> = {}): ScreenViewRust {
  return {
    id: 't1',
    entity: 'block',
    parent_id: 's1',
    name: '',
    query_json: JSON.stringify(EMPTY_QUERY),
    view_type: 'table',
    group_by: '',
    is_default: 0,
    sort_order: 1,
    config: '{}',
    created_at: 1000,
    updated_at: 1000,
    ...overrides,
  }
}

/** s1 下三个 tab（sort_order 1/2/3），选中 s1/t1。 */
function setupStore() {
  const store = useScreenViewStore('block')
  store.views = [
    makeScreen(),
    makeTab({ id: 't1', sort_order: 1 }),
    makeTab({ id: 't2', sort_order: 2 }),
    makeTab({ id: 't3', sort_order: 3 }),
  ]
  store.currentScreenId = 's1'
  store.currentTabId = 't1'
  return store
}

function mountBar() {
  return mount(NamedViewBar, {
    props: { entityKey: 'block', viewTypes: [{ key: 'table', label: '表格' }] },
    global: { stubs: { BasePopover: true } },
  })
}

/** 模拟 Sortable 把第 from 个 .tab 移到第 to 个之前（与 Sortable 移动真实 DOM 一致）。 */
function moveTab(row: HTMLElement, from: number, to: number) {
  const tabs = row.querySelectorAll<HTMLElement>('.tab')
  row.insertBefore(tabs[from], tabs[to])
}

function domOrder(wrapper: ReturnType<typeof mountBar>): string[] {
  return wrapper.findAll('.tab').map((w) => w.attributes('data-id'))
}

describe('NamedViewBar tabs drag reorder (ADR-0044)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    capturedOptions.current = null
    mockReorderScreenViews.mockResolvedValue(undefined)
  })

  it('onMounted 初始化 Sortable（draggable/filter/forceFallback 配置接线正确）', () => {
    setupStore()
    const wrapper = mountBar()

    expect(capturedOptions.current).toBeTruthy()
    expect(capturedOptions.current!.draggable).toBe('.tab')
    expect(capturedOptions.current!.filter).toBe('.kebab, .rename, input, .action')
    expect(capturedOptions.current!.forceFallback).toBe(true)
    expect(capturedOptions.current!.delay).toBe(60)
    expect(capturedOptions.current!.animation).toBe(300)

    wrapper.unmount()
    expect(mockDestroy).toHaveBeenCalled()
  })

  it('onEnd 按 DOM 真实顺序计算有序 id 并触发持久化；localTabs/currentTabs 反映新序', async () => {
    const store = setupStore()
    const wrapper = mountBar()
    await flushPromises()

    expect(domOrder(wrapper)).toEqual(['t1', 't2', 't3'])

    // 模拟拖拽：t3 移到最前
    moveTab(wrapper.find('.tab-row').element, 2, 0)
    ;(capturedOptions.current!.onEnd as () => void)()
    await flushPromises()

    expect(mockReorderScreenViews).toHaveBeenCalledWith('block', 's1', ['t3', 't1', 't2'])
    expect(store.currentTabs.map((t) => t.id)).toEqual(['t3', 't1', 't2'])
    // localTabs mirror（v-for 数据源）重排
    expect(domOrder(wrapper)).toEqual(['t3', 't1', 't2'])

    wrapper.unmount()
  })

  it('无变化拖拽（原序归还）也按完整 id 数组触发 reorderTabs（后端幂等重写）', async () => {
    const store = setupStore()
    const wrapper = mountBar()
    await flushPromises()

    ;(capturedOptions.current!.onEnd as () => void)()
    await flushPromises()

    expect(mockReorderScreenViews).toHaveBeenCalledWith('block', 's1', ['t1', 't2', 't3'])
    expect(store.currentTabs.map((t) => t.id)).toEqual(['t1', 't2', 't3'])

    wrapper.unmount()
  })

  it('持久化失败时本地顺序回滚', async () => {
    const store = setupStore()
    mockReorderScreenViews.mockRejectedValueOnce(new Error('db down'))
    const wrapper = mountBar()
    await flushPromises()

    moveTab(wrapper.find('.tab-row').element, 2, 0)
    ;(capturedOptions.current!.onEnd as () => void)()
    await flushPromises()

    expect(store.currentTabs.map((t) => t.id)).toEqual(['t1', 't2', 't3'])

    wrapper.unmount()
  })

  it('预览块 Y 轴锁：onStart 后每次移动把幽灵块 transform 的 f 分量归零、e 保留；onEnd 后卸锁', async () => {
    setupStore()
    const fakeSortable = Sortable as unknown as { ghost: HTMLElement | null }
    const ghost = document.createElement('div')
    const setTransform = (e: number, f: number) => {
      const t = `matrix(1, 0, 0, 1, ${e}, ${f})`
      ghost.style.transform = t
      ghost.style.webkitTransform = t
    }
    fakeSortable.ghost = ghost

    // jsdom 序列化 transform 时会去掉逗号后的空格，比较前归一化
    const norm = (s: string) => s.replace(/\s+/g, '')

    try {
      const wrapper = mountBar()
      await flushPromises()

      // onStart 挂锁后，首次移动（f≠0）被钳回 0，e 原样保留
      setTransform(-200, 150)
      ;(capturedOptions.current!.onStart as () => void)()
      document.dispatchEvent(new MouseEvent('mousemove'))
      expect(norm(ghost.style.transform)).toBe('matrix(1,0,0,1,-200,0)')

      // Sortable 每次移动重写 transform，钳制持续生效（X 继续累积不受影响）
      setTransform(-150, 90)
      document.dispatchEvent(new MouseEvent('mousemove'))
      expect(norm(ghost.style.transform)).toBe('matrix(1,0,0,1,-150,0)')

      // pointermove 同样钳制
      setTransform(-100, 60)
      document.dispatchEvent(new Event('pointermove'))
      expect(norm(ghost.style.transform)).toBe('matrix(1,0,0,1,-100,0)')

      // onEnd 卸锁：之后写入的 f 不再被归零
      ;(capturedOptions.current!.onEnd as () => void)()
      await flushPromises()
      setTransform(-50, 40)
      document.dispatchEvent(new MouseEvent('mousemove'))
      expect(norm(ghost.style.transform)).toBe('matrix(1,0,0,1,-50,40)')

      wrapper.unmount()
    } finally {
      fakeSortable.ghost = null
    }
  })
})

describe('NamedViewBar 分段控件（2026-09-23 改造）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    capturedOptions.current = null
  })

  it('Tab 条是纯文字分段控件：无类型图标 / 无拖拽 grip，Screen 触发器隐藏', () => {
    setupStore()
    const wrapper = mountBar()

    expect(wrapper.find('.screen-trigger').exists()).toBe(false)
    expect(wrapper.find('.tab-row').exists()).toBe(true)
    expect(wrapper.findAll('.tab')).toHaveLength(3)
    // tab 内只剩名称文本（未命名 tab 回退为类型名）
    expect(wrapper.find('.tab .ico').exists()).toBe(false)
    expect(wrapper.find('.tab .nvb-grip').exists()).toBe(false)
    expect(wrapper.find('.tab .name').text()).toBe('表格')

    wrapper.unmount()
  })
})

// ── 脏态操作（清除 / 保存）：用户报告「无法激活」的回归网 ──
// 三层：① 脏态确实渲染两个 action（门是 dirtyHint → diffQueryParts）；
// ② 点击真的落到 store 动作上（Sortable filter 与组件守卫都可能把它静默吃掉）；
// ③ 拖拽守卫是「结束时间窗」而非常真标志——常真标志一旦因 onEnd 未触发而卡住，
//    两个按钮会永久静默失效且没有任何视觉线索（与「无法激活」同形）。
function dirtyQuery() {
  return {
    version: 1,
    filter: { combinator: 'and', children: [{ field: 'status', op: 'eq', value: 'Todo' }] },
    sort: [],
    groupBy: null,
  } as never
}

describe('NamedViewBar 脏态操作（清除 / 保存）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    capturedOptions.current = null
    mockReorderScreenViews.mockResolvedValue(undefined)
  })

  async function mountDirty() {
    const store = setupStore()
    const wrapper = mountBar()
    await flushPromises()
    store.setWorkingQuery(dirtyQuery())
    await flushPromises()
    return { store, wrapper }
  }

  it('脏态渲染 清除/保存；点「清除」回到已提交查询，提示与按钮随之消失', async () => {
    const { store, wrapper } = await mountDirty()

    expect(wrapper.find('.tab-hint').text()).toBe('你调整了筛选')
    expect(wrapper.findAll('.tab .action').map((a) => a.text())).toEqual(['清除', '保存'])

    await wrapper.findAll('.tab .action')[0].trigger('click')
    await flushPromises()

    expect(store.workingQuery).toEqual(EMPTY_QUERY)
    expect(store.dirtyByTab.has('t1')).toBe(false)
    expect(wrapper.find('.tab .action').exists()).toBe(false)
    expect(wrapper.find('.tab-hint').exists()).toBe(false)

    wrapper.unmount()
  })

  it('点「保存」以 workingQuery 序列化落库，回流覆盖本地已提交查询', async () => {
    const { store, wrapper } = await mountDirty()
    mockUpdateTab.mockImplementation(async (id: string, name: string, vt: string, qj: string, cfg: string) =>
      makeTab({ id, name, view_type: vt, query_json: qj, config: cfg }),
    )

    await wrapper.findAll('.tab .action')[1].trigger('click')
    await flushPromises()

    expect(mockUpdateTab).toHaveBeenCalledWith('t1', '', 'table', JSON.stringify(dirtyQuery()), '{}')
    expect(store.dirtyByTab.has('t1')).toBe(false)
    expect(wrapper.find('.tab .action').exists()).toBe(false)

    wrapper.unmount()
  })

  it('拖拽守卫是结束时间窗：未拖过立即可用、拖后窗口内静默、窗口外自动恢复（不粘死）', async () => {
    const { store, wrapper } = await mountDirty()

    /** 点「清除」并返回本次是否真的生效（脏标被清 = 动作跑到了）。 */
    const clickClear = async () => {
      await wrapper.findAll('.tab .action')[0].trigger('click')
      await flushPromises()
      const fired = !store.dirtyByTab.has('t1')
      if (fired) {
        // 真实 discardActiveTab 已清掉脏态 → 重建，保证按钮始终在场
        store.setWorkingQuery(dirtyQuery())
        await flushPromises()
      }
      return fired
    }

    // 从未拖拽过（dragEndedAt = 0）→ 不得被读成「刚拖完」
    expect(await clickClear()).toBe(true)

    // 拖拽结束 → 抑制窗内点击静默
    ;(capturedOptions.current!.onEnd as () => void)()
    expect(await clickClear()).toBe(false)

    // 越过抑制窗（DRAG_CLICK_SUPPRESS_MS = 200）后自动恢复，无需任何清理回调兜底
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(await clickClear()).toBe(true)

    wrapper.unmount()
  })

  it('拖拽只 onStart 未 onEnd（onEnd 丢失）时点击仍可用 —— 守卫不可能粘死', async () => {
    const { store, wrapper } = await mountDirty()

    // 起拖后 onEnd 永不触发。旧实现（常真 isDragging，只在 onEnd 复位）会在此永久冻结
    // tab 点击 / ⋯ / 清除 / 保存，且零视觉线索——本用例就是该失效形态的回归网。
    ;(capturedOptions.current!.onStart as () => void)()
    await flushPromises()

    await wrapper.findAll('.tab .action')[0].trigger('click')
    await flushPromises()
    expect(store.dirtyByTab.has('t1')).toBe(false)
    expect(wrapper.find('.tab .action').exists()).toBe(false)

    // 收尾：补一次 onEnd 卸掉幽灵块 Y 轴锁，避免 document 监听泄漏到后续用例
    ;(capturedOptions.current!.onEnd as () => void)()
    await flushPromises()

    wrapper.unmount()
  })
})
