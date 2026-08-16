import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import DatePicker from '../DatePicker.vue'
import CalendarPopover from '../../CalendarPopover.vue'

type Emitted = string | [string, string] | undefined
function last(w: ReturnType<typeof mount>): Emitted {
  const e = w.emitted('update:modelValue')
  return e ? (e[e.length - 1][0] as Emitted) : undefined
}

describe('DatePicker', () => {
  it('single: 默认占位符「选择日期」', () => {
    const w = mount(DatePicker, { props: { mode: 'single' } })
    expect(w.find('[data-testid="dp-trigger"]').text()).toContain('选择日期')
  })

  it('single: 点击触发器展开日历，选一天 emit 该日期并收起', async () => {
    const w = mount(DatePicker, { props: { mode: 'single', modelValue: undefined } })
    await w.find('[data-testid="dp-trigger"]').trigger('click')
    await nextTick()
    const cal = w.findComponent(CalendarPopover)
    expect(cal.exists()).toBe(true)
    await cal.vm.$emit('select', '2026-03-15')
    await nextTick()
    expect(last(w)).toBe('2026-03-15')
    // 单选选完即收起（面板不再渲染）
    expect(w.findComponent(CalendarPopover).exists()).toBe(false)
  })

  it('single: 受控值回填到触发器文本', () => {
    const w = mount(DatePicker, { props: { mode: 'single', modelValue: '2026-03-15' } })
    expect(w.find('[data-testid="dp-trigger"]').text()).toContain('2026-03-15')
  })

  it('range: 两击选择 emit [from,to] 并收起', async () => {
    const w = mount(DatePicker, { props: { mode: 'range', modelValue: undefined } })
    await w.find('[data-testid="dp-trigger"]').trigger('click')
    await nextTick()
    // 第一击：设起点，保持展开
    await w.findComponent(CalendarPopover).vm.$emit('select', '2026-03-10')
    await w.setProps({ modelValue: ['2026-03-10', ''] })
    await nextTick()
    expect(last(w)).toEqual(['2026-03-10', ''])
    expect(w.findComponent(CalendarPopover).exists()).toBe(true) // 仍展开以选终点
    // 第二击：设终点，收起
    await w.findComponent(CalendarPopover).vm.$emit('select', '2026-03-20')
    await w.setProps({ modelValue: ['2026-03-10', '2026-03-20'] })
    await nextTick()
    expect(last(w)).toEqual(['2026-03-10', '2026-03-20'])
    expect(w.findComponent(CalendarPopover).exists()).toBe(false)
  })

  it('range: 反向选择（终点早于起点）→ 视为新起点', async () => {
    const w = mount(DatePicker, { props: { mode: 'range', modelValue: undefined } })
    await w.find('[data-testid="dp-trigger"]').trigger('click')
    await nextTick()
    await w.findComponent(CalendarPopover).vm.$emit('select', '2026-03-20')
    await w.setProps({ modelValue: ['2026-03-20', ''] })
    await nextTick()
    // 再点更早的日期 → 重置为起点
    await w.findComponent(CalendarPopover).vm.$emit('select', '2026-03-10')
    await w.setProps({ modelValue: ['2026-03-10', ''] })
    await nextTick()
    expect(last(w)).toEqual(['2026-03-10', ''])
  })

  it('range: 起止已齐后再次点击开启新区间（先清起点）', async () => {
    const w = mount(DatePicker, { props: { mode: 'range', modelValue: ['2026-03-10', '2026-03-20'] } })
    await w.find('[data-testid="dp-trigger"]').trigger('click')
    await nextTick()
    await w.findComponent(CalendarPopover).vm.$emit('select', '2026-04-01')
    await w.setProps({ modelValue: ['2026-04-01', ''] })
    await nextTick()
    expect(last(w)).toEqual(['2026-04-01', ''])
  })

  it('再次点击触发器收起面板', async () => {
    const w = mount(DatePicker, { props: { mode: 'single' } })
    await w.find('[data-testid="dp-trigger"]').trigger('click')
    await nextTick()
    expect(w.findComponent(CalendarPopover).exists()).toBe(true)
    await w.find('[data-testid="dp-trigger"]').trigger('click')
    await nextTick()
    expect(w.findComponent(CalendarPopover).exists()).toBe(false)
  })
})
