import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import NumberInput from '../NumberInput.vue'

function emitLast(w: ReturnType<typeof mount>): number | undefined {
  const e = w.emitted('update:modelValue')
  return e ? (e[e.length - 1][0] as number | undefined) : undefined
}

describe('NumberInput（ADR-0055）', () => {
  it('渲染输入框 + 两个步进按钮 + 占位符', () => {
    const w = mount(NumberInput, { props: { placeholder: '输入数值' } })
    expect(w.find('input').exists()).toBe(true)
    expect(w.findAll('.ni-step')).toHaveLength(2)
    expect((w.find('input').element as HTMLInputElement).placeholder).toBe('输入数值')
  })

  it('受控值回填到输入框', () => {
    const w = mount(NumberInput, { props: { modelValue: 42 } })
    expect((w.find('input').element as HTMLInputElement).value).toBe('42')
  })

  it('失焦：越界值夹到 max', async () => {
    const w = mount(NumberInput, { props: { modelValue: 0, min: 0, max: 10 } })
    const input = w.find('input')
    await input.setValue('99')
    await input.trigger('blur')
    await input.trigger('blur') // 二次确保 commit 已跑
    expect(emitLast(w)).toBe(10)
  })

  it('失焦：越界值夹到 min', async () => {
    const w = mount(NumberInput, { props: { modelValue: 5, min: 0, max: 10 } })
    const input = w.find('input')
    await input.setValue('-5')
    await input.trigger('blur')
    expect(emitLast(w)).toBe(0)
  })

  it('失焦：step 就近取整（基准 min）', async () => {
    const w = mount(NumberInput, { props: { modelValue: 0, min: 0, max: 10, step: 5 } })
    const input = w.find('input')
    await input.setValue('7')
    await input.trigger('blur')
    expect(emitLast(w)).toBe(5)
  })

  it('清空输入框 → emit undefined（删值行语义）', async () => {
    const w = mount(NumberInput, { props: { modelValue: 3 } })
    const input = w.find('input')
    await input.setValue('')
    await input.trigger('blur')
    expect(emitLast(w)).toBeUndefined()
  })

  it('步进按钮：无 step 时 +1', async () => {
    const w = mount(NumberInput, { props: { modelValue: 0 } })
    w.vm.increment()
    expect(emitLast(w)).toBe(1)
  })

  it('步进按钮：带 step 时按 step 递增', async () => {
    const w = mount(NumberInput, { props: { modelValue: 0, step: 5 } })
    w.vm.increment()
    expect(emitLast(w)).toBe(5)
  })

  it('步进按钮：夹边界（max 限制）', async () => {
    const w = mount(NumberInput, { props: { modelValue: 9, max: 10, step: 5 } })
    w.vm.increment()
    expect(emitLast(w)).toBe(10)
  })

  it('无 step 允许自由小数', async () => {
    const w = mount(NumberInput, { props: { modelValue: 0 } })
    const input = w.find('input')
    await input.setValue('3.14')
    await input.trigger('blur')
    expect(emitLast(w)).toBe(3.14)
  })
})
