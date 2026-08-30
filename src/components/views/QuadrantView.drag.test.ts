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

  it('未拖动（仅点击）仍触发 navigate', async () => {
    const w = mountView({ items: makeItems(), idKey: 'block_id' })
    const cardA = cardWithText(w, '任务A')

    await fire(cardA, 'pointerdown', { button: 0, clientX: 0, clientY: 0 })
    await fire(cardA, 'pointerup', { button: 0, clientX: 0, clientY: 0 })
    await fire(cardA, 'click')

    const nav = w.emitted('navigate')
    expect(nav).toBeTruthy()
    expect(nav!.length).toBe(1)
    expect(nav![0]).toEqual(['b1'])
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

    expect(w.emitted('navigate')).toBeUndefined()
    expect(w.emitted('cellChange')!.length).toBe(1)
    w.unmount()
  })
})
