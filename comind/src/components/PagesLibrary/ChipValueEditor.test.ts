import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ChipValueEditor from './ChipValueEditor.vue'
import CalendarPopover from '../CalendarPopover.vue'

const OPTS = [
  { id: 'normal', label: '普通' },
  { id: 'ideas', label: '灵感' },
]

function lastEmitted(wrapper: ReturnType<typeof mount>): unknown {
  const e = wrapper.emitted('update:modelValue')
  return e ? e[e.length - 1][0] : undefined
}

describe('ChipValueEditor', () => {
  it('text: 输入 emit 字符串', async () => {
    const w = mount(ChipValueEditor, {
      props: { fieldType: 'text', op: 'contains', modelValue: '' },
    })
    const input = w.find('[data-testid="cve-text"]')
    await input.setValue('hello')
    expect(lastEmitted(w)).toBe('hello')
  })

  it('number: 输入 emit 数字，空值 emit undefined', async () => {
    const w = mount(ChipValueEditor, {
      props: { fieldType: 'number', op: 'eq', modelValue: undefined },
    })
    const input = w.find('[data-testid="cve-number"]')
    await input.setValue('42')
    expect(lastEmitted(w)).toBe(42)
    await input.setValue('')
    expect(lastEmitted(w)).toBeUndefined()
  })

  it('select: 点选项 emit 对应 id', async () => {
    const w = mount(ChipValueEditor, {
      props: { fieldType: 'select', op: 'is', options: OPTS, modelValue: '' },
    })
    const target = w.findAll('[data-testid="cve-option"]').find((o) => o.text().includes('普通'))!
    await target.trigger('click')
    expect(lastEmitted(w)).toBe('normal')
  })

  it('multiSelect: 勾选两项 emit string[]', async () => {
    const w = mount(ChipValueEditor, {
      props: { fieldType: 'multiSelect', op: 'hasAny', options: OPTS, modelValue: undefined },
    })
    const opts = w.findAll('[data-testid="cve-option"]')
    await opts[0].trigger('click')
    await w.setProps({ modelValue: ['normal'] })
    await opts[1].trigger('click')
    expect(lastEmitted(w)).toEqual(['normal', 'ideas'])
  })

  it('multiSelect: 再点已选项取消勾选', async () => {
    const w = mount(ChipValueEditor, {
      props: { fieldType: 'multiSelect', op: 'hasAny', options: OPTS, modelValue: ['normal'] },
    })
    await w.findAll('[data-testid="cve-option"]')[0].trigger('click')
    expect(lastEmitted(w)).toBeUndefined()
  })

  it('boolean: 是/否 切换 emit true/false', async () => {
    const w = mount(ChipValueEditor, {
      props: { fieldType: 'boolean', op: 'is', modelValue: false },
    })
    const btns = w.findAll('.cve-bool button')
    await btns[0].trigger('click')
    expect(lastEmitted(w)).toBe(true)
    await btns[1].trigger('click')
    expect(lastEmitted(w)).toBe(false)
  })

  it('date 单日期: 点触发器展开日历，选日期 emit yyyy-MM-dd', async () => {
    const w = mount(ChipValueEditor, {
      props: { fieldType: 'date', op: 'after', modelValue: '' },
    })
    await w.find('.cve-date-trigger').trigger('click')
    const cal = w.findComponent(CalendarPopover)
    expect(cal.exists()).toBe(true)
    await cal.vm.$emit('select', '2026-01-15')
    await nextTick()
    expect(lastEmitted(w)).toBe('2026-01-15')
  })

  it('date between: 两段各选一次 emit [from,to]', async () => {
    const w = mount(ChipValueEditor, {
      props: { fieldType: 'date', op: 'between', modelValue: undefined },
    })
    const triggers = w.findAll('.cve-date-trigger')
    await triggers[0].trigger('click') // from
    await w.findComponent(CalendarPopover).vm.$emit('select', '2026-01-10')
    await nextTick()
    await w.setProps({ modelValue: ['2026-01-10', ''] })
    await triggers[1].trigger('click') // to
    await w.findComponent(CalendarPopover).vm.$emit('select', '2026-01-20')
    await nextTick()
    expect(lastEmitted(w)).toEqual(['2026-01-10', '2026-01-20'])
  })

  it('isEmpty/isNotEmpty: 无值，渲染占位符且不渲染输入控件', () => {
    const w = mount(ChipValueEditor, {
      props: { fieldType: 'text', op: 'isEmpty', modelValue: '' },
    })
    expect(w.find('.cve-dash').exists()).toBe(true)
    expect(w.find('[data-testid="cve-text"]').exists()).toBe(false)
  })
})
