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

  describe('快捷动态值（今日/昨日/.../本月末）', () => {
    /** 走 wrapper.vm 上的测试钩子，绕过 jsdom 下 Teleport 后 DOM 合成事件不确定性。 */
    it('single: 点击「今日」emit 当天 yyyy-MM-DD 并收起', async () => {
      const w = mount(DatePicker, {
        props: { mode: 'single', modelValue: undefined },
      })
      ;(w.vm as unknown as { applyShortcut: (k: string) => void }).applyShortcut('today')
      await nextTick()
      const exp = last(w)
      expect(typeof exp).toBe('string')
      expect(exp).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      const today = new Date()
      const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      expect(exp).toBe(todayIso)
    })

    it('single: 键入「+3」调 commitCustom emit 三天后', async () => {
      const w = mount(DatePicker, {
        props: { mode: 'single', modelValue: undefined },
      })
      // 直接走自定义输入框：因为通过 vm.commitCustom 内部读 ref customInput.value，
      // 这里先同步 ref 再 commit（vitest/jsdom 下 v-model 与实际 input 同步链路有时效问题）
      ;(w.vm as unknown as { customInput: string }).customInput = '+3'
      ;(w.vm as unknown as { commitCustom: () => void }).commitCustom()
      await nextTick()
      const exp = last(w)
      expect(typeof exp).toBe('string')
      const d = new Date(exp as string)
      const e = new Date()
      e.setDate(e.getDate() + 3)
      expect(d.getFullYear()).toBe(e.getFullYear())
      expect(d.getMonth()).toBe(e.getMonth())
      expect(d.getDate()).toBe(e.getDate())
    })

    it('single: 键入「今天」commit 后 emit 当天', async () => {
      const w = mount(DatePicker, {
        props: { mode: 'single', modelValue: undefined },
      })
      ;(w.vm as unknown as { customInput: string }).customInput = '今天'
      ;(w.vm as unknown as { commitCustom: () => void }).commitCustom()
      await nextTick()
      expect(last(w)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('single: 键入乱码 → 设置错误、不 emit', async () => {
      const w = mount(DatePicker, {
        props: { mode: 'single', modelValue: undefined },
      })
      ;(w.vm as unknown as { customInput: string }).customInput = 'last week'
      ;(w.vm as unknown as { commitCustom: () => void; customError: string }).commitCustom()
      await nextTick()
      expect(last(w)).toBeUndefined()
      expect((w.vm as unknown as { customError: string }).customError).toMatch(/^无法识别/)
    })

    it('range: phase=from 时快捷按钮设起点；phase=to 时设终点', async () => {
      const w = mount(DatePicker, {
        props: { mode: 'range', modelValue: undefined },
      })
      const api = w.vm as unknown as { applyShortcut: (k: string) => void }
      api.applyShortcut('today')
      await nextTick()
      const first = last(w)
      expect(Array.isArray(first)).toBe(true)
      const [from] = first as [string, string]
      expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      // 模拟父级回写
      await w.setProps({ modelValue: [from, ''] })
      await nextTick()
      api.applyShortcut('tomorrow')
      await nextTick()
      const second = last(w)
      expect(Array.isArray(second)).toBe(true)
      const [, to] = second as [string, string]
      expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
  })

  describe('dynamic 模式：快捷/键入 emit 表达式 token（不固化日期）', () => {
    it('single+dynamic: 快捷「今日」emit "today" token 而非日期', async () => {
      const w = mount(DatePicker, { props: { mode: 'single', dynamic: true } })
      const api = w.vm as unknown as { applyShortcut: (k: string) => void }
      api.applyShortcut('today')
      await nextTick()
      expect(last(w)).toBe('today')
    })

    it('single+dynamic: 键入 "+3" emit 原文 token（不 resolve）', async () => {
      const w = mount(DatePicker, { props: { mode: 'single', dynamic: true } })
      const vm = w.vm as unknown as { customInput: string; commitCustom: () => void }
      vm.customInput = '+3'
      vm.commitCustom()
      await nextTick()
      expect(last(w)).toBe('+3')
    })

    it('single+dynamic: 键入乱码 → 错误、不 emit', async () => {
      const w = mount(DatePicker, { props: { mode: 'single', dynamic: true } })
      const vm = w.vm as unknown as { customInput: string; commitCustom: () => void; customError: string }
      vm.customInput = 'last week'
      vm.commitCustom()
      await nextTick()
      expect(last(w)).toBeUndefined()
      expect(vm.customError).toMatch(/^无法识别/)
    })

    it('range + dynamic（不生效）: 快捷仍 resolve 为静态日期区间', async () => {
      const w = mount(DatePicker, { props: { mode: 'range', dynamic: true } })
      const api = w.vm as unknown as { applyShortcut: (k: string) => void }
      api.applyShortcut('today')
      await nextTick()
      const first = last(w)
      expect(Array.isArray(first)).toBe(true)
      const [from] = first as [string, string]
      expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
  })
})
