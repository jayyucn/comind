/**
 * TaskHub 四象限新增任务落点测试（issue #66 — ADR-0042 T1 落点改造）
 *
 * 行为约定：
 * 1. handleQuadrantAdd 改调 pageStore.ensureTodayIdeasPage 获取今日 Ideas 页，
 *    不再 getOrCreatePageByTitle('任务收集') 创建/复用普通容器页。
 * 2. 新任务块以 parentId=null 落今日 Ideas 页根级（saveBlockTree 载荷 page_id=今日 Ideas 页、parent_id=null）。
 * 3. 保留 createBlock → flushSave → setProperty(status/priority) 链：先落 block 行再写属性。
 *
 * 测试跑在真实 comind-core（sqljs 内存库）上（先例：Block/index.test.ts）：
 * FK 约束真实生效——若 flushSave 先于 setProperty 的顺序被破坏，会抛 FOREIGN KEY 失败使用例失败。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import TaskHub from './TaskHub.vue'
import { usePageStore } from '../../stores/pages'
import { useBlockStore } from '../../stores/blocks'
import { usePropertyStore } from '../../stores/property'
import { getTestCore } from '../../../tests/core-client'

// jsdom 无 matchMedia；CodeMirrorEditor→useTheme 在模块级求值会调用它（先例：Block/index.test.ts）。
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

// WASM 客户端不支持 Screens/Tabs（createScreen 直接 throw），而 TaskHub onMounted 会调
// screenViewStore.load()——以轻量 store 桩替换，避免依赖 Tauri 专属通路。
// 注意：ensure_today_ideas_page（Rust）对「软删残留的今日页」重建会撞 Page.title UNIQUE
// （幂等检查只看 deleted=0，但创建是裸 INSERT，跳过 create 的 tombstone 复活）——这是既有
// Rust 边界，不属于本测试范围；因此用例间不清理页面，各自只断言自己创建的行。
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

// 外壳桩：仅渲染 #quadrant 插槽（其余插槽/视图不挂载，避免无关渲染依赖）。
const QueryPageFrameStub = defineComponent({
  name: 'QueryPageFrame',
  setup(_, { slots }) {
    return () => h('div', { class: 'qpf-stub' }, [slots.quadrant?.({ context: {} })])
  },
})
// 四象限视图桩：测试从桩上直接 $emit('addItem') 驱动 TaskHub 的 handleQuadrantAdd。
const QuadrantViewStub = defineComponent({
  name: 'QuadrantView',
  emits: ['addItem', 'cellChange', 'openBlock'],
  setup() {
    return () => h('div', { class: 'quadrant-stub' })
  },
})

const TODAY_PAGE_TITLE = new Date().toISOString().slice(0, 10)

function mountTaskHub() {
  return mount(TaskHub, {
    global: {
      stubs: { QueryPageFrame: QueryPageFrameStub, QuadrantView: QuadrantViewStub, PageDrawer: true },
    },
  })
}

/** 轮询等待异步链路完成（flushSave 内部有动态 import + 多次 WASM 往返，超出 flushPromises 的单轮窗口） */
async function waitFor(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor timeout after ${timeoutMs}ms`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

/** 从 QuadrantView 桩触发一次新增并等待 createBlock→flushSave→setProperty×2 全部完成 */
async function addFromQuadrant(priority: string, title: string) {
  const wrapper = mountTaskHub()
  await flushPromises() // onMounted（screenView.load + blockCard.getCards）
  const qv = wrapper.findComponent(QuadrantViewStub)
  expect(qv.exists()).toBe(true)
  const setPropertySpy = vi.spyOn(getTestCore()!, 'setProperty')
  qv.vm.$emit('addItem', priority, title)
  await flushPromises()
  await waitFor(() => setPropertySpy.mock.calls.length === 2)
  return { wrapper, setPropertySpy }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('TaskHub — 四象限新增任务落点', () => {
  it('新增任务调用 ensureTodayIdeasPage，以 parentId=null 落今日 Ideas 页根级，不再创建「任务收集」', async () => {
    const pageStore = usePageStore()
    const ensureSpy = vi.spyOn(pageStore, 'ensureTodayIdeasPage')
    const client = getTestCore()!
    const saveTreeSpy = vi.spyOn(client, 'saveBlockTree')

    const { wrapper } = await addFromQuadrant('Urgent', '四象限新增-落今日Ideas')

    // 1) 走 ensureTodayIdeasPage（而非 getOrCreatePageByTitle('任务收集')）
    expect(ensureSpy).toHaveBeenCalledTimes(1)

    // 2) 块真实建在今日 Ideas 页根级（parentId=null）
    const blockStore = useBlockStore()
    const block = blockStore.blocks.find((b) => b.content === '四象限新增-落今日Ideas')
    expect(block).toBeDefined()
    expect(block!.parentId).toBeNull()
    const page = pageStore.pages.find((p) => p.id === block!.pageId)
    expect(page?.type).toBe('ideas')
    expect(page?.title).toBe(TODAY_PAGE_TITLE)

    // saveBlockTree 载荷同源：page_id=今日 Ideas 页、parent_id=null
    const payload = saveTreeSpy.mock.calls[0][0][0]
    expect(payload.page_id).toBe(block!.pageId)
    expect(payload.parent_id).toBeNull()

    // 3) 不再创建/复用「任务收集」遗留页
    expect(pageStore.pages.some((p) => p.title === '任务收集')).toBe(false)

    wrapper.unmount()
  })

  it('保留 createBlock → flushSave → setProperty 链：先落 block 行再写 status/priority 属性', async () => {
    const client = getTestCore()!
    const blockStore = useBlockStore()
    const propertyStore = usePropertyStore()
    const saveTreeSpy = vi.spyOn(client, 'saveBlockTree')
    const setPropertySpy = vi.spyOn(client, 'setProperty')

    const { wrapper } = await addFromQuadrant('High', '四象限新增-FK链验证')

    // 顺序：block 行必须先于属性写入（真实 sqlite 外键约束下乱序会直接失败）
    expect(saveTreeSpy).toHaveBeenCalled()
    expect(setPropertySpy).toHaveBeenCalledTimes(2)
    expect(saveTreeSpy.mock.invocationCallOrder[0]).toBeLessThan(setPropertySpy.mock.invocationCallOrder[0])

    // status=Todo、priority=象限值真实落库（store 本地态 + 真实 DB 双确认）
    const block = blockStore.blocks.find((b) => b.content === '四象限新增-FK链验证')!
    const localProps = propertyStore.getBlockProperties(block.id)
    const localKv = Object.fromEntries(localProps.map((p) => [p.key, p.value]))
    expect(localKv['status']).toBe('Todo')
    expect(localKv['priority']).toBe('High')

    const props = await client.getProperties(block.id)
    const kv = Object.fromEntries(props.map((p) => [p.key, p.value]))
    expect(kv['status']).toBe('Todo')
    expect(kv['priority']).toBe('High')

    wrapper.unmount()
  })
})
