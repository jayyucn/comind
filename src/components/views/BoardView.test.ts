import { describe, it, expect, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import BoardView from './BoardView.vue'
import type { BlockCard } from '../../wasm/types'
import type { FieldDescriptor } from '../../core/query'

/**
 * jsdom 的 MouseEvent 构造会忽略 clientX/clientY 初始化（默认 0），
 * 用 defineProperty 覆盖只读属性以模拟真实指针坐标/按键。
 */
function fire(el: Element, type: string, opts: Record<string, unknown> = {}) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 })
  for (const [k, v] of Object.entries(opts)) {
    Object.defineProperty(ev, k, { value: v, configurable: true })
  }
  el.dispatchEvent(ev)
  return nextTick()
}

function makeCard(overrides: Partial<BlockCard> = {}): BlockCard {
  const base: BlockCard = {
    block_id: 'block-1',
    page_id: 'page-1',
    parent_id: '',
    content_preview: 'Test card',
    properties: {},
    date_refs: [],
    updated_at: 1723000000000,
    created_at: 1723000000000,
    ...overrides,
  }
  return JSON.parse(JSON.stringify(base))
}

// 仿 Block 注册表：status(分组) / content(标题) / priority(带色) / deadline(date)
function makeFields(): FieldDescriptor[] {
  return [
    { key: 'content', label: '内容', type: 'string', get: (i) => (i as BlockCard).content_preview },
    {
      key: 'status', label: '状态', type: 'select',
      options: [
        { id: 'Todo', label: '待办', color: '#9CA3AF' },
        { id: 'Doing', label: '进行中', color: '#D97706' },
        { id: 'Done', label: '已完成', color: '#10B981' },
        { id: 'Canceled', label: '已取消', color: '#9CA3AF' },
      ],
      get: (i) => (i as BlockCard).properties?.['status'] ?? 'Todo',
    },
    {
      key: 'priority', label: '优先级', type: 'select',
      options: [
        { id: 'Low', label: '低', color: '#9CA3AF' },
        { id: 'High', label: '高', color: '#F59E0B' },
      ],
      get: (i) => (i as BlockCard).properties?.['priority'],
    },
    {
      key: 'deadline', label: '截止', type: 'date',
      get: (i) => (i as BlockCard).date_refs?.find((d) => d.kind === 'deadline')?.date_day
        ?? (i as BlockCard).date_refs?.find((d) => d.kind === 'schedule')?.date_day,
    },
  ]
}

const fields = makeFields()

function mountBoard(props: Record<string, unknown> = {}) {
  return mount(BoardView, {
    props: {
      items: [makeCard()],
      fields,
      groupBy: 'status',
      config: { viewKind: 'board', version: 1, cardFields: ['priority', 'deadline'] },
      idKey: 'block_id',
      ...props,
    },
  })
}

describe('BoardView (generic, field-driven)', () => {
  it('derives columns from groupBy field options', () => {
    const wrapper = mountBoard({ items: [] })
    const titles = wrapper.findAll('.column-title').map((t) => t.text())
    expect(titles).toContain('待办')
    expect(titles).toContain('进行中')
    expect(titles).toContain('已完成')
    expect(titles).toContain('已取消')
  })

  it('places cards into matching group columns', () => {
    const cards = [
      makeCard({ block_id: 'b1', content_preview: 'Todo task', properties: { status: 'Todo' } }),
      makeCard({ block_id: 'b2', content_preview: 'Doing task', properties: { status: 'Doing' } }),
      makeCard({ block_id: 'b3', content_preview: 'Done task', properties: { status: 'Done' } }),
    ]
    const wrapper = mountBoard({ items: cards })
    const cols = wrapper.findAll('.board-column')
    expect(cols[0].text()).toContain('Todo task')
    expect(cols[1].text()).toContain('Doing task')
    expect(cols[2].text()).toContain('Done task')
  })

  it('defaults missing group value to first column (Todo)', () => {
    const wrapper = mountBoard({ items: [makeCard({ content_preview: 'Fresh', properties: {} })] })
    expect(wrapper.findAll('.board-column')[0].text()).toContain('Fresh')
  })

  it('shows card counts per column', () => {
    const cards = [
      makeCard({ block_id: 'b1', properties: { status: 'Todo' } }),
      makeCard({ block_id: 'b2', properties: { status: 'Todo' } }),
      makeCard({ block_id: 'b3', properties: { status: 'Doing' } }),
    ]
    const wrapper = mountBoard({ items: cards })
    const counts = wrapper.findAll('.column-count')
    expect(counts[0].text()).toBe('2')
    expect(counts[1].text()).toBe('1')
  })

  it('renders colored chip for priority (Option.color)', () => {
    const wrapper = mountBoard({ items: [makeCard({ properties: { priority: 'High' } })] })
    expect(wrapper.find('.card-chip').exists()).toBe(true)
    expect(wrapper.find('.card-chip').text()).toContain('高')
  })

  it('renders overdue deadline chip', () => {
    const wrapper = mountBoard({
      items: [makeCard({ date_refs: [{ kind: 'deadline', iso: '2020-01-01', date_day: '2020-01-01', recurrence: 'none', event_ts: 0 }] })],
    })
    const chip = wrapper.find('.card-chip.overdue')
    expect(chip.exists()).toBe(true)
  })

  it('hides chips when cardFields empty', () => {
    const wrapper = mountBoard({
      items: [makeCard({ properties: { priority: 'High' } })],
      config: { viewKind: 'board', version: 1 },
    })
    expect(wrapper.find('.card-chip').exists()).toBe(false)
  })

  it('emits navigate on card click', async () => {
    const wrapper = mountBoard({ items: [makeCard({ block_id: 'b1', content_preview: 'Click me' })] })
    await wrapper.find('.board-card').trigger('click')
    expect(wrapper.emitted('navigate')).toBeTruthy()
    expect(wrapper.emitted('navigate')![0]).toEqual(['b1'])
  })
})

// 分组字段无兜底取值（标签自定义字段的常态：成员大多没填）→ 缺值卡片必须有落脚列
describe('BoardView 未分组列', () => {
  const stageFields: FieldDescriptor[] = [
    { key: 'content', label: '内容', type: 'string', get: (i) => (i as BlockCard).content_preview },
    {
      key: 'stage', label: '阶段', type: 'select',
      options: [{ id: 'Draft', label: '草稿' }, { id: 'Live', label: '上线' }],
      get: (i) => (i as BlockCard).properties?.['stage'],
    },
  ]

  function mountStage(items: BlockCard[]) {
    return mount(BoardView, {
      props: {
        items,
        fields: stageFields,
        groupBy: 'stage',
        config: { viewKind: 'board', version: 1 },
        idKey: 'block_id',
      },
    })
  }

  // 拖拽用例：指针监听挂在 window 上，必须 attachTo body 才能冒泡到位（末尾 unmount 清理）
  function mountStageDrag(items: BlockCard[]) {
    return mount(BoardView, {
      attachTo: document.body,
      props: {
        items,
        fields: stageFields,
        groupBy: 'stage',
        config: { viewKind: 'board', version: 1 },
        idKey: 'block_id',
      },
    })
  }

  it('缺值卡片进入「未分组」列而非消失', () => {
    const wrapper = mountStage([
      makeCard({ block_id: 'b1', content_preview: '已排期', properties: { stage: 'Draft' } }),
      makeCard({ block_id: 'b2', content_preview: '没填阶段', properties: {} }),
    ])
    const titles = wrapper.findAll('.column-title').map((t) => t.text())
    expect(titles).toEqual(['草稿', '上线', '未分组'])
    const last = wrapper.findAll('.board-column').at(-1)!
    expect(last.text()).toContain('没填阶段')
    expect(last.text()).not.toContain('已排期')
  })

  it('无缺值卡片时不追加「未分组」列', () => {
    const wrapper = mountStage([
      makeCard({ block_id: 'b1', properties: { stage: 'Draft' } }),
      makeCard({ block_id: 'b2', properties: { stage: 'Live' } }),
    ])
    expect(wrapper.findAll('.column-title').map((t) => t.text())).toEqual(['草稿', '上线'])
  })

  it('拖入「未分组」列不写入分组字段（未分组不是合法取值）', async () => {
    // 必须存在缺值卡片，否则「未分组」列根本不会出现
    const wrapper = mountStageDrag([
      makeCard({ block_id: 'b1', properties: { stage: 'Draft' } }),
      makeCard({ block_id: 'b2', properties: {} }),
    ])
    const unassignedCol = wrapper.findAll('.board-column').at(-1)!
    expect(unassignedCol.find('.column-title').text()).toBe('未分组')
    const card = wrapper.findAll('.board-card')[0]
    await fire(card.element, 'pointerdown', { clientX: 0, clientY: 0, button: 0 })
    await fire(unassignedCol.element, 'pointermove', { clientX: 100, clientY: 100 })
    await fire(unassignedCol.element, 'pointerup', { clientX: 100, clientY: 100 })
    expect(wrapper.emitted('cellChange')).toBeFalsy()
    wrapper.unmount()
  })

  it('从「未分组」拖到有值列可正常写入', async () => {
    const wrapper = mountStageDrag([makeCard({ block_id: 'b1', properties: {} })])
    const liveCol = wrapper.findAll('.board-column')[1]
    const card = wrapper.findAll('.board-card')[0]
    await fire(card.element, 'pointerdown', { clientX: 0, clientY: 0, button: 0 })
    await fire(liveCol.element, 'pointermove', { clientX: 100, clientY: 100 })
    await fire(liveCol.element, 'pointerup', { clientX: 100, clientY: 100 })
    expect(wrapper.emitted('cellChange')![0]).toEqual(['b1', 'stage', 'Live'])
    wrapper.unmount()
  })

  it('multiSelect 空数组视为未分组', () => {
    const fields: FieldDescriptor[] = [
      stageFields[0],
      {
        key: 'stage', label: '阶段', type: 'multiSelect',
        options: [{ id: 'Draft', label: '草稿' }],
        get: (i) => (i as BlockCard).properties?.['stage'],
      },
    ]
    const wrapper = mount(BoardView, {
      props: {
        items: [makeCard({ block_id: 'b1', properties: { stage: [] } })],
        fields,
        groupBy: 'stage',
        config: { viewKind: 'board', version: 1 },
        idKey: 'block_id',
      },
    })
    expect(wrapper.findAll('.column-title').map((t) => t.text())).toContain('未分组')
  })
})

// 列底染色（面板化观感）：任务中心默认关，标签聚合页开
describe('BoardView 列底染色', () => {
  const stageFields = (ids: string[]): FieldDescriptor[] => [
    { key: 'content', label: '内容', type: 'string', get: (i) => (i as BlockCard).content_preview },
    {
      key: 'stage', label: '阶段', type: 'select',
      options: ids.map((id) => ({ id, label: id })),
      get: (i) => (i as BlockCard).properties?.['stage'],
    },
  ]

  function mountTinted(opts: { ids: string[]; tint: boolean; items?: BlockCard[]; groupBy?: string; fields?: FieldDescriptor[] }) {
    return mount(BoardView, {
      props: {
        items: opts.items ?? [],
        fields: opts.fields ?? stageFields(opts.ids),
        groupBy: opts.groupBy ?? 'stage',
        config: { viewKind: 'board', version: 1 },
        idKey: 'block_id',
        tintColumns: opts.tint,
      },
    })
  }

  it('默认不染色（任务中心的分组是状态机，不给列序冒充语义）', () => {
    const wrapper = mountTinted({ ids: ['Todo', 'Doing'], tint: false })
    expect(wrapper.findAll('.board-column.is-tinted').length).toBe(0)
    expect(wrapper.findAll('.board-column')[0].attributes('style')).toBeUndefined()
  })

  it('开启后按列序轮转调色板：从蓝起、跳过灰', () => {
    const wrapper = mountTinted({ ids: ['A', 'B', 'C'], tint: true })
    const styles = wrapper.findAll('.board-column').map((c) => c.attributes('style'))
    expect(styles[0]).toContain('--tag-color-8') // 蓝
    expect(styles[1]).toContain('--tag-color-9') // 紫
    expect(styles[2]).toContain('--tag-color-10') // 洋红
    expect(styles.join(' ')).not.toContain('--tag-color-1 ') // 灰不参与
  })

  it('分组值自带语义色时优先用它', () => {
    const wrapper = mountTinted({ ids: [], tint: true, fields, groupBy: 'status' })
    expect(wrapper.findAll('.board-column')[0].attributes('style')).toContain('#9CA3AF')
  })

  it('「未分组」列不染色且不消耗色位', () => {
    const wrapper = mountTinted({
      ids: ['A', 'B'],
      tint: true,
      items: [makeCard({ block_id: 'b1', properties: {} })],
    })
    const cols = wrapper.findAll('.board-column')
    expect(cols.at(-1)!.find('.column-title').text()).toBe('未分组')
    expect(cols.at(-1)!.classes()).not.toContain('is-tinted')
    expect(cols[0].attributes('style')).toContain('--tag-color-8')
    expect(cols[1].attributes('style')).toContain('--tag-color-9')
  })
})

// 拖拽改用 Pointer Events：原生 HTML5 DnD 在 Tauri webview 下不触发 dragstart（象限视图同源事故）
describe('BoardView 拖拽（Pointer Events）', () => {
  function mountDrag(items: BlockCard[]) {
    return mount(BoardView, {
      attachTo: document.body,
      props: {
        items,
        fields,
        groupBy: 'status',
        config: { viewKind: 'board', version: 1, cardFields: ['priority'] },
        idKey: 'block_id',
      },
    })
  }

  function colByKey(w: ReturnType<typeof mount>, key: string) {
    return w.findAll('.board-column').find((c) => c.attributes('data-col-key') === key)!.element
  }

  it('不再是原生 DnD（卡片无 draggable 属性）', () => {
    const wrapper = mountDrag([makeCard({ block_id: 'b1', properties: { status: 'Todo' } })])
    expect(wrapper.find('.board-card').attributes('draggable')).toBeUndefined()
    wrapper.unmount()
  })

  it('拖到另一列 emit cellChange(groupBy)', async () => {
    const wrapper = mountDrag([makeCard({ block_id: 'b1', properties: { status: 'Todo' } })])
    const card = wrapper.find('.board-card').element
    const doing = colByKey(wrapper, 'Doing')

    await fire(card, 'pointerdown', { clientX: 0, clientY: 0 })
    await fire(doing, 'pointermove', { clientX: 100, clientY: 100 })
    await fire(doing, 'pointerup', { clientX: 100, clientY: 100 })

    expect(wrapper.emitted('cellChange')!.length).toBe(1)
    expect(wrapper.emitted('cellChange')![0]).toEqual(['b1', 'status', 'Doing'])
    wrapper.unmount()
  })

  it('位移不足 6px 视为点击：emit navigate，不写库', async () => {
    const wrapper = mountDrag([makeCard({ block_id: 'b1', properties: { status: 'Todo' } })])
    const card = wrapper.find('.board-card')

    await fire(card.element, 'pointerdown', { clientX: 0, clientY: 0 })
    await fire(card.element, 'pointerup', { clientX: 2, clientY: 2 })
    await fire(card.element, 'click')

    expect(wrapper.emitted('cellChange')).toBeUndefined()
    expect(wrapper.emitted('navigate')![0]).toEqual(['b1'])
    wrapper.unmount()
  })

  it('拖到同一列不写库（无效操作）', async () => {
    const wrapper = mountDrag([makeCard({ block_id: 'b1', properties: { status: 'Todo' } })])
    const card = wrapper.find('.board-card').element
    const todo = colByKey(wrapper, 'Todo')

    await fire(card, 'pointerdown', { clientX: 0, clientY: 0 })
    await fire(todo, 'pointermove', { clientX: 100, clientY: 100 })
    await fire(todo, 'pointerup', { clientX: 100, clientY: 100 })

    expect(wrapper.emitted('cellChange')).toBeUndefined()
    wrapper.unmount()
  })

  it('拖拽中渲染 ghost，松手后清除；拖拽后的 click 不误触 navigate', async () => {
    const wrapper = mountDrag([makeCard({ block_id: 'b1', content_preview: '写周报', properties: { status: 'Todo' } })])
    const card = wrapper.find('.board-card')
    const done = colByKey(wrapper, 'Done')

    await fire(card.element, 'pointerdown', { clientX: 0, clientY: 0 })
    await fire(done, 'pointermove', { clientX: 120, clientY: 90 })
    // ghost 经 Teleport 渲染到 body
    expect(document.body.querySelector('.board-drag-ghost')?.textContent).toContain('写周报')

    await fire(done, 'pointerup', { clientX: 120, clientY: 90 })
    expect(document.body.querySelector('.board-drag-ghost')).toBeNull()

    await fire(card.element, 'click')
    expect(wrapper.emitted('navigate')).toBeUndefined()
    expect(wrapper.emitted('cellChange')!.length).toBe(1)
    wrapper.unmount()
  })
})

// 横向滚动：全局关掉了原生滚动条（styles/components/_scrollbar.scss），替代它的浮层指示条
// 只实现纵轴（overlayScrollbar.ts 只认纵向溢出），所以列数超出视口时看板一条滚动条都没有。
// 组件补了四条入口：滚轮接力 / 边缘翻页 / 键盘 / 拖拽边缘自动滚。
describe('BoardView 横向滚动（无滚动条）', () => {
  type Metrics = { clientWidth: number; scrollWidth: number; scrollLeft: number }

  function rect(left: number, width: number): DOMRect {
    return {
      left,
      right: left + width,
      top: 0,
      bottom: 100,
      width,
      height: 100,
      x: left,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect
  }

  /**
   * jsdom 没有布局：clientWidth/scrollWidth/scrollLeft 恒为 0，getBoundingClientRect 全零。
   * 这里按给定指标造假，并让列矩形随 scrollLeft 左移，才能测「还有几列完全不可见」。
   */
  async function mountScroll(m: Metrics) {
    const wrapper = mount(BoardView, {
      attachTo: document.body,
      props: {
        items: [makeCard({ block_id: 'b1', content_preview: '卡片', properties: { status: 'Todo' } })],
        fields,
        groupBy: 'status',
        config: { viewKind: 'board', version: 1 },
        idKey: 'block_id',
      },
    })
    const el = wrapper.find('.board-view').element as HTMLElement
    Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => m.clientWidth })
    Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => m.scrollWidth })
    Object.defineProperty(el, 'scrollLeft', {
      configurable: true,
      get: () => m.scrollLeft,
      set: (v: number) => {
        m.scrollLeft = v
      },
    })
    ;(el as unknown as { scrollTo: (o: ScrollToOptions) => void }).scrollTo = (o) => {
      m.scrollLeft = o.left ?? 0
    }
    el.getBoundingClientRect = () => rect(0, m.clientWidth)
    wrapper.findAll('.board-column').forEach((c, i) => {
      ;(c.element as HTMLElement).getBoundingClientRect = () => rect(12 + i * 268 - m.scrollLeft, 260)
    })
    el.dispatchEvent(new Event('scroll'))
    await nextTick()
    return { wrapper, el, m }
  }

  function nextFrame(times = 1) {
    return new Promise<void>((resolve) => {
      let n = 0
      const step = () => {
        n += 1
        if (n >= times) resolve()
        else requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    })
  }

  /** 造一个「列内还能纵向滚」的卡片列表（jsdom 不应用 SFC 样式，须用内联样式让 overflowY 生效）。 */
  function makeScrollableList(wrapper: ReturnType<typeof mount>, scrollHeight = 500, clientHeight = 200) {
    const list = wrapper.find('.column-cards').element as HTMLElement
    list.style.overflowY = 'auto'
    Object.defineProperty(list, 'clientHeight', { configurable: true, get: () => clientHeight })
    Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => scrollHeight })
    Object.defineProperty(list, 'scrollTop', { configurable: true, writable: true, value: 0 })
    return list as HTMLElement & { scrollTop: number }
  }

  it('右侧有完全不可见的列时显示「还有 N 列」，最左时不显示左箭头', async () => {
    // 4 列 @260 + gap，视口 600：第 4 列（left 816）完全在视口外
    const { wrapper } = await mountScroll({ clientWidth: 600, scrollWidth: 1400, scrollLeft: 0 })
    expect(wrapper.find('.board-pager.is-right').text()).toContain('还有 1 列')
    expect(wrapper.find('.board-pager.is-left').exists()).toBe(false)
    wrapper.unmount()
  })

  it('只切掉半截列时按钮仍在，但不再报数字（位置信号与可滚性分开）', async () => {
    // scrollLeft 400：末列 left 416 仍未越过 600 → 0 列完全不可见，但仍有 400px 可滚
    const { wrapper } = await mountScroll({ clientWidth: 600, scrollWidth: 1400, scrollLeft: 400 })
    expect(wrapper.find('.board-pager.is-right').exists()).toBe(true)
    expect(wrapper.find('.board-pager.is-right .pager-label').exists()).toBe(false)
    expect(wrapper.find('.board-pager.is-left').exists()).toBe(true)
    wrapper.unmount()
  })

  it('滚到最右端后右侧按钮消失、左侧保留', async () => {
    const { wrapper } = await mountScroll({ clientWidth: 600, scrollWidth: 1400, scrollLeft: 800 })
    expect(wrapper.find('.board-pager.is-right').exists()).toBe(false)
    expect(wrapper.find('.board-pager.is-left').exists()).toBe(true)
    wrapper.unmount()
  })

  it('点右侧按钮翻一屏减一列', async () => {
    const { wrapper, m } = await mountScroll({ clientWidth: 600, scrollWidth: 1400, scrollLeft: 0 })
    await wrapper.find('.board-pager.is-right').trigger('click')
    // 600 - (260 + 8 gap) = 332
    expect(m.scrollLeft).toBe(332)
    wrapper.unmount()
  })

  it('滚轮接力：列内还有余量时不横滚，滚到底后交棒给看板', async () => {
    const { wrapper, m } = await mountScroll({ clientWidth: 600, scrollWidth: 1400, scrollLeft: 0 })
    const list = makeScrollableList(wrapper)
    const card = wrapper.find('.board-card').element

    card.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }))
    await nextTick()
    expect(m.scrollLeft).toBe(0)

    // 列内滚到底（scrollHeight 500 - clientHeight 200 = 300）
    list.scrollTop = 300
    card.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }))
    await nextTick()
    expect(m.scrollLeft).toBe(120)
    wrapper.unmount()
  })

  it('触控板横滑（|deltaX| 更大）不接管，交给浏览器原生', async () => {
    const { wrapper, m } = await mountScroll({ clientWidth: 600, scrollWidth: 1400, scrollLeft: 0 })
    const card = wrapper.find('.board-card').element
    card.dispatchEvent(new WheelEvent('wheel', { deltaX: 120, deltaY: 10, bubbles: true, cancelable: true }))
    await nextTick()
    expect(m.scrollLeft).toBe(0)
    wrapper.unmount()
  })

  it('键盘：←/→ 滚一列，Home/End 到首末列', async () => {
    const { wrapper, el, m } = await mountScroll({ clientWidth: 600, scrollWidth: 1400, scrollLeft: 0 })
    const key = async (k: string) => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
      await nextTick()
    }

    await key('ArrowRight')
    expect(m.scrollLeft).toBe(268) // jsdom 中 offsetWidth 为 0 → 回退 260 + gap 8
    await key('ArrowRight')
    expect(m.scrollLeft).toBe(536)
    await key('End')
    expect(m.scrollLeft).toBe(800)
    await key('ArrowLeft')
    expect(m.scrollLeft).toBe(532)
    await key('Home')
    expect(m.scrollLeft).toBe(0)
    wrapper.unmount()
  })

  it('连按 → 累积前进：平滑动画未落地时不会「按 3 次只走 1 列」', async () => {
    const { wrapper, el } = await mountScroll({ clientWidth: 600, scrollWidth: 1400, scrollLeft: 0 })
    // 模拟平滑动画：scrollTo 只记目标，不立刻改 scrollLeft（真机连按失效的成因）
    let pending = 0
    ;(el as unknown as { scrollTo: (o: ScrollToOptions) => void }).scrollTo = (o) => {
      pending = o.left ?? 0
    }
    const key = (k: string) => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
    }
    key('ArrowRight')
    key('ArrowRight')
    await nextTick()
    expect(pending).toBe(536) // 2 × 268，而不是每次都从 0 重新算
    wrapper.unmount()
  })

  it('滚轮/平移接管后作废累积目标（不会把用户手动滚到的地方拽回旧目标）', async () => {
    const { wrapper, el, m } = await mountScroll({ clientWidth: 600, scrollWidth: 1400, scrollLeft: 0 })
    ;(el as unknown as { scrollTo: (o: ScrollToOptions) => void }).scrollTo = (o) => {
      m.scrollLeft = o.left ?? 0
    }
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    await nextTick()
    expect(m.scrollLeft).toBe(268)

    // 用户滚轮横滚到 500，随后按键应从 500 继续，而不是从 268
    const card = wrapper.find('.board-card').element
    card.dispatchEvent(new WheelEvent('wheel', { deltaY: 232, bubbles: true, cancelable: true }))
    await nextTick()
    expect(m.scrollLeft).toBe(500)

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    await nextTick()
    expect(m.scrollLeft).toBe(768)
    wrapper.unmount()
  })

  // 分屏 / 侧栏折叠 / 后台标签切回都只改祖先宽度，window 不 resize：
  // 没有 R.O. 时 `boardScrollMax` 停在旧值，翻页按钮与 grab 光标一起说谎。
  describe('容器尺寸变化（ResizeObserver）', () => {
    function stubResizeObserver() {
      const state = { cb: null as (() => void) | null, observed: [] as Element[] }
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(cb: () => void) {
            state.cb = cb
          }

          observe(el: Element) {
            state.observed.push(el)
          }

          disconnect() {
            state.observed.length = 0
          }
        },
      )
      return state
    }

    it('观察看板容器本身（不是 window）', async () => {
      const ro = stubResizeObserver()
      const { wrapper, el } = await mountScroll({ clientWidth: 1200, scrollWidth: 1200, scrollLeft: 0 })
      expect(ro.observed).toContain(el)
      wrapper.unmount()
      vi.unstubAllGlobals()
    })

    it('容器变窄后重新测量：翻页按钮 / grab 光标跟上（分屏打开的那一帧）', async () => {
      const ro = stubResizeObserver()
      // 挂载时是单栏撑满：内容正好放得下，没有任何可滚余量
      const m = { clientWidth: 1200, scrollWidth: 1200, scrollLeft: 0 }
      const { wrapper } = await mountScroll(m)
      expect(wrapper.find('.board-pager.is-right').exists()).toBe(false)
      expect(wrapper.find('.board-view').classes()).not.toContain('can-pan')

      // 打开分屏：容器变窄 600，内容没变 → 出现 600 余量（window 没 resize）
      m.clientWidth = 600
      ro.cb!()
      await nextTick()

      expect(wrapper.find('.board-pager.is-right').exists()).toBe(true)
      expect(wrapper.find('.board-view').classes()).toContain('can-pan')
      wrapper.unmount()
      vi.unstubAllGlobals()
    })

    it('容器变宽到放得下时按钮退场（不留「点了没反应」的死按钮）', async () => {
      const ro = stubResizeObserver()
      const m = { clientWidth: 600, scrollWidth: 1400, scrollLeft: 0 }
      const { wrapper } = await mountScroll(m)
      expect(wrapper.find('.board-pager.is-right').exists()).toBe(true)

      m.clientWidth = 1400
      ro.cb!()
      await nextTick()

      expect(wrapper.find('.board-pager.is-right').exists()).toBe(false)
      expect(wrapper.find('.board-view').classes()).not.toContain('can-pan')
      wrapper.unmount()
      vi.unstubAllGlobals()
    })
  })

  it('拖拽到边缘自动横滚，且边缘按钮让开落格采样；松手即停', async () => {
    const { wrapper, el, m } = await mountScroll({ clientWidth: 600, scrollWidth: 1400, scrollLeft: 0 })
    const card = wrapper.find('.board-card').element

    await fire(card, 'pointerdown', { clientX: 100, clientY: 100 })
    await fire(el, 'pointermove', { clientX: 580, clientY: 100 }) // 进入右触边带（600-60）
    expect(wrapper.find('.board-pager.is-right').classes()).toContain('is-dragging')

    await nextFrame(3)
    const scrolled = m.scrollLeft
    expect(scrolled).toBeGreaterThan(0)

    await fire(el, 'pointerup', { clientX: 580, clientY: 100 })
    await nextFrame(2)
    expect(m.scrollLeft).toBe(scrolled) // 松手后不再滚
    expect(wrapper.find('.board-pager.is-right').classes()).not.toContain('is-dragging')
    wrapper.unmount()
  })

  // 空白区拖拽平移：桌面鼠标在这里按住拖动本来不产生滚动，只会选中跨列文本（真机实测），
  // 而这块区域占看板可见面积 79.4%，是唯一能连续横向定位的入口。
  describe('空白区拖拽平移（grab-to-pan）', () => {
    it('向右拖 → scrollLeft 反向移动（内容跟手）', async () => {
      const { wrapper, el, m } = await mountScroll({ clientWidth: 600, scrollWidth: 1400, scrollLeft: 400 })
      await fire(el, 'pointerdown', { clientX: 300, clientY: 100, button: 0 })
      await fire(el, 'pointermove', { clientX: 200, clientY: 100 })
      expect(m.scrollLeft).toBe(500) // 指针左移 100 → 内容左移、视口右移
      await fire(el, 'pointermove', { clientX: 400, clientY: 100 })
      expect(m.scrollLeft).toBe(300)
      await fire(el, 'pointerup', { clientX: 400, clientY: 100 })
      wrapper.unmount()
    })

    it('位移被 clamp 在可滚范围内，不会滚出边界', async () => {
      const { wrapper, el, m } = await mountScroll({ clientWidth: 600, scrollWidth: 1400, scrollLeft: 400 })
      await fire(el, 'pointerdown', { clientX: 300, clientY: 100, button: 0 })
      await fire(el, 'pointermove', { clientX: 2000, clientY: 100 })
      expect(m.scrollLeft).toBe(0)
      await fire(el, 'pointermove', { clientX: -2000, clientY: 100 })
      expect(m.scrollLeft).toBe(800) // max = 1400 - 600
      await fire(el, 'pointerup', { clientX: -2000, clientY: 100 })
      wrapper.unmount()
    })

    it('小于 6px 视为点击，不进入平移（轻点不会让看板轻微位移）', async () => {
      const { wrapper, el, m } = await mountScroll({ clientWidth: 600, scrollWidth: 1400, scrollLeft: 400 })
      await fire(el, 'pointerdown', { clientX: 300, clientY: 100, button: 0 })
      await fire(el, 'pointermove', { clientX: 296, clientY: 100 })
      expect(m.scrollLeft).toBe(400)
      expect(wrapper.find('.board-view').classes()).not.toContain('is-panning')
      await fire(el, 'pointerup', { clientX: 296, clientY: 100 })
      wrapper.unmount()
    })

    it('从卡片上起手不平移（左键拖卡片是改分组）', async () => {
      const { wrapper, el, m } = await mountScroll({ clientWidth: 600, scrollWidth: 1400, scrollLeft: 400 })
      const card = wrapper.find('.board-card').element
      await fire(card, 'pointerdown', { clientX: 300, clientY: 100, button: 0 })
      await fire(el, 'pointermove', { clientX: 100, clientY: 100 })
      expect(m.scrollLeft).toBe(400)
      await fire(el, 'pointerup', { clientX: 100, clientY: 100 })
      wrapper.unmount()
    })

    it('从列头上起手不平移（列头留给将来的列排序）', async () => {
      const { wrapper, el, m } = await mountScroll({ clientWidth: 600, scrollWidth: 1400, scrollLeft: 400 })
      const header = wrapper.find('.column-header').element
      await fire(header, 'pointerdown', { clientX: 300, clientY: 100, button: 0 })
      await fire(el, 'pointermove', { clientX: 100, clientY: 100 })
      expect(m.scrollLeft).toBe(400)
      await fire(el, 'pointerup', { clientX: 100, clientY: 100 })
      wrapper.unmount()
    })

    it('不可滚时没有 can-pan 光标，拖动也不接管', async () => {
      const { wrapper, el, m } = await mountScroll({ clientWidth: 600, scrollWidth: 600, scrollLeft: 0 })
      expect(wrapper.find('.board-view').classes()).not.toContain('can-pan')
      await fire(el, 'pointerdown', { clientX: 300, clientY: 100, button: 0 })
      await fire(el, 'pointermove', { clientX: 100, clientY: 100 })
      expect(m.scrollLeft).toBe(0)
      await fire(el, 'pointerup', { clientX: 100, clientY: 100 })
      wrapper.unmount()
    })

    it('触摸不接管（原生横滑已够用）', async () => {
      const { wrapper, el, m } = await mountScroll({ clientWidth: 600, scrollWidth: 1400, scrollLeft: 400 })
      await fire(el, 'pointerdown', { clientX: 300, clientY: 100, button: 0, pointerType: 'touch' })
      await fire(el, 'pointermove', { clientX: 100, clientY: 100 })
      expect(m.scrollLeft).toBe(400)
      await fire(el, 'pointerup', { clientX: 100, clientY: 100 })
      wrapper.unmount()
    })

    it('平移后紧随的 click 被吞掉，不冒泡到外层（避免被当成「点了空白」）', async () => {
      const { wrapper, el } = await mountScroll({ clientWidth: 600, scrollWidth: 1400, scrollLeft: 400 })
      const shell = wrapper.find('.board-shell').element
      let outerClicks = 0
      shell.addEventListener('click', () => {
        outerClicks += 1
      })
      await fire(el, 'pointerdown', { clientX: 300, clientY: 100, button: 0 })
      await fire(el, 'pointermove', { clientX: 200, clientY: 100 })
      await fire(el, 'pointerup', { clientX: 200, clientY: 100 })
      await fire(el, 'click', { clientX: 200, clientY: 100 })
      expect(outerClicks).toBe(0)
      // 只吞一次：下一次点击正常冒泡
      await fire(el, 'click', { clientX: 200, clientY: 100 })
      expect(outerClicks).toBe(1)
      wrapper.unmount()
    })

    it('平移起手把焦点收进看板（键盘 ←/→ 的前提），并标记为「指针焦点」以抑制焦点环', async () => {
      const { wrapper, el } = await mountScroll({ clientWidth: 600, scrollWidth: 1400, scrollLeft: 400 })
      // 先让别处持有焦点，模拟分屏时左侧编辑器正在编辑
      const outside = document.createElement('input')
      document.body.appendChild(outside)
      outside.focus()
      await fire(el, 'pointerdown', { clientX: 300, clientY: 100, button: 0 })
      // 焦点必须移走：否则 ←/→ 会去挪左栏编辑器的光标，看板一动不动
      expect(document.activeElement).toBe(el)
      expect(wrapper.find('.board-view').classes()).toContain('is-pointer-focus')
      await fire(el, 'pointerup', { clientX: 300, clientY: 100 })
      // 指针焦点标记随 blur 清掉：下次 Tab 进来仍会画焦点环
      el.blur()
      await nextTick()
      expect(wrapper.find('.board-view').classes()).not.toContain('is-pointer-focus')
      outside.remove()
      wrapper.unmount()
    })

    it('点空白后再按 → 直接横滚（键盘收口：焦点已随点击进看板）', async () => {
      const { wrapper, el, m } = await mountScroll({ clientWidth: 600, scrollWidth: 1400, scrollLeft: 0 })
      const outside = document.createElement('input')
      document.body.appendChild(outside)
      outside.focus()
      await fire(el, 'pointerdown', { clientX: 300, clientY: 100, button: 0 })
      await fire(el, 'pointerup', { clientX: 300, clientY: 100 })
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
      )
      await nextTick()
      expect(m.scrollLeft).toBe(268)
      outside.remove()
      wrapper.unmount()
    })
  })
})
