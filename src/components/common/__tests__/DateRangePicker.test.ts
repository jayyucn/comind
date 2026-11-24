import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import DateRangePicker from '../DateRangePicker.vue'
import CalendarPopover from '../../CalendarPopover.vue'

type Emitted = { start: string; end: string } | undefined
function last(w: ReturnType<typeof mount>): Emitted {
  const e = w.emitted('update:modelValue')
  return e ? (e[e.length - 1][0] as Emitted) : undefined
}

describe('DateRangePicker（issue T8）', () => {
  it('默认占位符「选择日期区间」', () => {
    const w = mount(DateRangePicker)
    expect(w.find('[data-testid="drp-trigger"]').text()).toContain('选择日期区间')
  })

  it('两端齐：显示「start → end」', () => {
    const w = mount(DateRangePicker, { props: { modelValue: { start: '2026-01-01', end: '2026-01-31' } } })
    expect(w.find('[data-testid="drp-text"]').text()).toBe('2026-01-01 → 2026-01-31')
  })

  it('只有一端：降级显示单端', () => {
    const startOnly = mount(DateRangePicker, { props: { modelValue: { start: '2026-01-01', end: '' } } })
    expect(startOnly.find('[data-testid="drp-text"]').text()).toBe('2026-01-01')
    const endOnly = mount(DateRangePicker, { props: { modelValue: { start: '', end: '2026-01-31' } } })
    expect(endOnly.find('[data-testid="drp-text"]').text()).toBe('2026-01-31')
  })

  it('两击选择：第一击设起点不提交且保持展开，第二击设终点提交 {start,end} 并收起', async () => {
    const w = mount(DateRangePicker)
    await w.find('[data-testid="drp-trigger"]').trigger('click')
    await nextTick()
    const cal = () => w.findComponent(CalendarPopover)
    expect(cal().exists()).toBe(true)

    // 第一击：设起点（内部草稿态，不对外提交）
    await cal().vm.$emit('select', '2026-03-10')
    await nextTick()
    expect(last(w)).toBeUndefined()
    expect(cal().exists()).toBe(true) // 仍展开以选终点

    // 第二击：设终点，两端齐才提交
    await cal().vm.$emit('select', '2026-03-20')
    await nextTick()
    expect(last(w)).toEqual({ start: '2026-03-10', end: '2026-03-20' })
    expect(cal().exists()).toBe(false) // 收起
  })

  it('逆序纠正：第二击早于起点 → 视为新起点，不提交', async () => {
    const w = mount(DateRangePicker)
    await w.find('[data-testid="drp-trigger"]').trigger('click')
    await nextTick()
    await w.findComponent(CalendarPopover).vm.$emit('select', '2026-03-20')
    await nextTick()
    await w.findComponent(CalendarPopover).vm.$emit('select', '2026-03-10')
    await nextTick()
    expect(last(w)).toBeUndefined()
    // 草稿重置为新起点，面板仍展开以选终点
    expect(w.findComponent(CalendarPopover).exists()).toBe(true)
    expect(w.find('[data-testid="drp-text"]').text()).toBe('2026-03-10')
  })

  it('清除按钮 → emit undefined（未填 = 删行契约）', async () => {
    const w = mount(DateRangePicker, { props: { modelValue: { start: '2026-01-01', end: '2026-01-31' } } })
    await w.find('[data-testid="drp-clear"]').trigger('click')
    await nextTick()
    expect(last(w)).toBeUndefined()
    expect(w.find('[data-testid="drp-text"]').text()).toContain('选择日期区间')
  })

  it('再次点击触发器收起面板', async () => {
    const w = mount(DateRangePicker)
    await w.find('[data-testid="drp-trigger"]').trigger('click')
    await nextTick()
    expect(w.findComponent(CalendarPopover).exists()).toBe(true)
    await w.find('[data-testid="drp-trigger"]').trigger('click')
    await nextTick()
    expect(w.findComponent(CalendarPopover).exists()).toBe(false)
  })
})
