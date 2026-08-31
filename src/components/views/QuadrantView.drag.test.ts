import { describe, it, expect } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import QuadrantView from './QuadrantView.vue'

// 卡片渲染接入 BulletRender（内部 useBlockStore），挂载需注入 pinia
function mountView(props: Record<string, unknown>) {
  return mount(QuadrantView, { attachTo: document.body, global: { plugins: [createPinia()] }, props })
}

function makeItems() {
  return [
    {
      block_id: 'b1',
      content_preview: '任务A',
      properties: { status: 'Todo', priority: 'Medium' },
      date_refs: [],
    },
    {
      block_id: 'b2',
      content_preview: '任务B',
      properties: { status: 'Doing', priority: 'Low' },
      date_refs: [],
    },
  ]
}

function fire(el: Element, type: string, opts: Record<string, number> = {}) {
  // jsdom 的 MouseEvent 构造会忽略 clientX/clientY 初始化（默认 0），
  // 用 defineProperty 覆盖只读属性以模拟真实指针坐标/按键。
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 })
  for (const [k, v] of Object.entries(opts)) {
    Object.defineProperty(ev, k, { value: v, configurable: true })
  }
  el.dispatchEvent(ev)
  return nextTick()
}

function sectionWithPriority(w: ReturnType<typeof mount>, priority: string) {
  return w.findAll('.q-cell').find((s) => s.attributes('data-priority') === priority)!.element
}
function cardWithText(w: ReturnType<typeof mount>, text: string) {
  return w.findAll('.q-card').find((c) => c.text().includes(text))!.element
}

describe('QuadrantView 拖拽（Pointer Events）', () => {
  it('卡片按 priority 落入对应象限', () => {
    const w = mountView({ items: makeItems(), idKey: 'block_id' })
    expect(w.findAll('.q-card').length).toBe(2)
    expect(w.text()).toContain('任务A')
    expect(w.text()).toContain('任务B')
    const priorities = w.findAll('.q-cell').map((s) => s.attributes('data-priority'))
    expect(priorities.sort()).toEqual(['High', 'Low', 'Medium', 'Urgent'])
    w.unmount()
  })

  it('指针拖拽到目标象限 emit cellChange(priority)', async () => {
    const w = mountView({ items: makeItems(), idKey: 'block_id' })
    const cardA = cardWithText(w, '任务A')
    const urgent = sectionWithPriority(w, 'Urgent')

    await fire(cardA, 'pointerdown', { button: 0, clientX: 0, clientY: 0 })
    await fire(urgent, 'pointermove', { clientX: 100, clientY: 100 })
    await fire(urgent, 'pointerup', { clientX: 100, clientY: 100 })

    const emitted = w.emitted('cellChange')
    expect(emitted).toBeTruthy()
    expect(emitted!.length).toBe(1)
    expect(emitted![0]).toEqual(['b1', 'priority', 'Urgent'])
    w.unmount()
  })

  it('拖到同一象限不写库（无 cellChange）', async () => {
    const w = mountView({ items: makeItems(), idKey: 'block_id' })
    const cardA = cardWithText(w, '任务A')
    const medium = sectionWithPriority(w, 'Medium')

    await fire(cardA, 'pointerdown', { button: 0, clientX: 0, clientY: 0 })
    await fire(medium, 'pointermove', { clientX: 80, clientY: 80 })
    await fire(medium, 'pointerup', { clientX: 80, clientY: 80 })

    expect(w.emitted('cellChange')).toBeUndefined()
    w.unmount()
  })

  it('未拖动（仅点击）触发 openBlock', async () => {
    const w = mountView({ items: makeItems(), idKey: 'block_id' })
    const cardA = cardWithText(w, '任务A')

    await fire(cardA, 'pointerdown', { button: 0, clientX: 0, clientY: 0 })
    await fire(cardA, 'pointerup', { button: 0, clientX: 0, clientY: 0 })
    await fire(cardA, 'click')

    const opened = w.emitted('openBlock')
    expect(opened).toBeTruthy()
    expect(opened!.length).toBe(1)
    expect(opened![0]).toEqual(['b1'])
    w.unmount()
  })

  it('拖拽后松手不误触 navigate', async () => {
    const w = mountView({ items: makeItems(), idKey: 'block_id' })
    const cardA = cardWithText(w, '任务A')
    const urgent = sectionWithPriority(w, 'Urgent')

    await fire(cardA, 'pointerdown', { button: 0, clientX: 0, clientY: 0 })
    await fire(urgent, 'pointermove', { clientX: 100, clientY: 100 })
    await fire(urgent, 'pointerup', { clientX: 100, clientY: 100 })
    await fire(cardA, 'click')

    expect(w.emitted('openBlock')).toBeUndefined()
    expect(w.emitted('cellChange')!.length).toBe(1)
    w.unmount()
  })
})

describe('QuadrantView 子任务显示（最多 3 层）', () => {
  // 任务树：A(顶层,Medium) ─ B(子,无 priority) ─ C(孙,无 priority) ─ D(曾孙)
  // E(顶层,Urgent) 独立；A 的兄弟 B 有 priority 时应嵌套而非重复落格
  function makeTreeItems() {
    return [
      { block_id: 'a', parent_id: '', content_preview: '父任务A', properties: { status: 'Todo', priority: 'Medium' }, date_refs: [] },
      { block_id: 'b', parent_id: 'a', content_preview: '子任务B', properties: { status: 'Todo' }, date_refs: [] },
      { block_id: 'c', parent_id: 'b', content_preview: '孙任务C', properties: { status: 'Todo' }, date_refs: [] },
      { block_id: 'd', parent_id: 'c', content_preview: '曾孙任务D', properties: { status: 'Todo' }, date_refs: [] },
      { block_id: 'e', parent_id: '', content_preview: '任务E', properties: { status: 'Done', priority: 'Urgent' }, date_refs: [] },
    ]
  }

  it('子任务嵌套在父卡片内，不重复落格', () => {
    const w = mountView({ items: makeTreeItems(), idKey: 'block_id' })
    // 顶层卡片仅 A、E 两张；B/C/D 不再作为独立卡片
    expect(w.findAll('.q-card').length).toBe(2)
    // 子任务行渲染在卡片内：B（第 2 层）、C（第 3 层），D 超出 3 层上限不显示
    expect(w.findAll('.q-subtask').length).toBe(2)
    // A 卡片内包含 B（第 2 层）、C（第 3 层）
    const cardA = cardWithText(w, '父任务A')
    expect(cardA.querySelector('.q-subtask')?.textContent).toContain('子任务B')
    expect(cardA.textContent).toContain('孙任务C')
    // 曾孙 D 超出 3 层上限，不显示
    expect(w.text()).not.toContain('曾孙任务D')
    w.unmount()
  })

  it('有 priority 的子任务嵌套显示而非独立落格', () => {
    const items = makeTreeItems()
    // B 补上 priority：仍应嵌套在 A 下，不重复出现
    items[1] = { ...items[1], properties: { status: 'Todo', priority: 'Urgent' } }
    const w = mountView({ items, idKey: 'block_id' })
    expect(w.findAll('.q-card').length).toBe(2)
    expect(w.findAll('.q-subtask').length).toBe(2)
    w.unmount()
  })

  it('点击子任务行 emit openBlock(子任务 id)，且不触发父卡片', async () => {
    const w = mountView({ items: makeTreeItems(), idKey: 'block_id' })
    const cardA = cardWithText(w, '父任务A')
    const subB = cardA.querySelector('.q-subtask')!

    await fire(subB, 'pointerdown', { button: 0, clientX: 0, clientY: 0 })
    await fire(subB, 'pointerup', { button: 0, clientX: 0, clientY: 0 })
    await fire(subB, 'click')

    const opened = w.emitted('openBlock')
    expect(opened).toBeTruthy()
    expect(opened!.length).toBe(1)
    expect(opened![0]).toEqual(['b'])
    w.unmount()
  })

  it('无父级的父卡片点击仍打开父任务（回归）', async () => {
    const w = mountView({ items: makeTreeItems(), idKey: 'block_id' })
    const cardE = cardWithText(w, '任务E')
    await fire(cardE, 'pointerdown', { button: 0, clientX: 0, clientY: 0 })
    await fire(cardE, 'pointerup', { button: 0, clientX: 0, clientY: 0 })
    await fire(cardE, 'click')
    expect(w.emitted('openBlock')![0]).toEqual(['e'])
    w.unmount()
  })
})
